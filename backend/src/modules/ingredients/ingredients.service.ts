import { In, QueryFailedError } from "typeorm";

import { AppDataSource } from "../../database/data-source";
import { AppError } from "../../errors/app-error";
import { DailyAllocation } from "./daily-allocation.entity";
import { IngredientCategory } from "./ingredient-category.entity";
import { Ingredient } from "./ingredient.entity";
import { IngredientStockLog } from "./ingredient-stock-log.entity";
import { IngredientStock } from "./ingredient-stock.entity";
import { IngredientStockLogType, type IngredientUnit } from "./ingredients.constants";
import { ItemIngredient } from "../items/item-ingredient.entity";
import { AddOnIngredient } from "../items/add-on-ingredient.entity";
import { InvoiceUsageEvent } from "../invoices/invoice-usage-event.entity";
import { PosBillingControl } from "./pos-billing-control.entity";
import { StaffClosingReport } from "./staff-closing-report.entity";
import { UserRole } from "../../constants/roles";

type PaginationQuery = {
  page: number;
  limit: number;
};

type CategoryListFilters = PaginationQuery & {
  search?: string;
  includeInactive?: boolean;
};

type IngredientListFilters = PaginationQuery & {
  search?: string;
  categoryId?: string;
  includeInactive?: boolean;
};

type AllocationListFilters = PaginationQuery & {
  date: string;
  search?: string;
  categoryId?: string;
  overall?: boolean;
};

type AllocationStatsFilters = {
  date: string;
  search?: string;
  categoryId?: string;
};

type StockLogListFilters = PaginationQuery;

const getNumericValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toFixedQuantity = (value: number) => Number(value.toFixed(3));

const getPaginationMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit))
});

const getStockStatus = (totalStock: number, minStock: number) => (totalStock <= minStock ? "LOW_STOCK" : "OK");

const getTodayDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getPreviousDateString = (value: string) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return getTodayDateString();
  }
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
};

const getDateOnlyString = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getStartOfDay = (date: Date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
};

const getEndOfDay = (date: Date) => {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
};

export class IngredientsService {
  private readonly categoryRepository = AppDataSource.getRepository(IngredientCategory);
  private readonly ingredientRepository = AppDataSource.getRepository(Ingredient);
  private readonly stockRepository = AppDataSource.getRepository(IngredientStock);
  private readonly stockLogRepository = AppDataSource.getRepository(IngredientStockLog);
  private readonly allocationRepository = AppDataSource.getRepository(DailyAllocation);
  private readonly itemIngredientRepository = AppDataSource.getRepository(ItemIngredient);
  private readonly addOnIngredientRepository = AppDataSource.getRepository(AddOnIngredient);
  private readonly usageEventRepository = AppDataSource.getRepository(InvoiceUsageEvent);
  private readonly posBillingControlRepository = AppDataSource.getRepository(PosBillingControl);
  private readonly closingReportRepository = AppDataSource.getRepository(StaffClosingReport);

  private async getActiveCategoryOrFail(categoryId: string) {
    const category = await this.categoryRepository.findOne({
      where: { id: categoryId, isActive: true }
    });

    if (!category) {
      throw new AppError(404, "Ingredient category not found");
    }

    return category;
  }

  private async getActiveIngredientOrFail(ingredientId: string) {
    const ingredient = await this.ingredientRepository.findOne({
      where: { id: ingredientId, isActive: true },
      relations: { category: true }
    });

    if (!ingredient) {
      throw new AppError(404, "Ingredient not found");
    }

    return ingredient;
  }

  private async createStockLog(payload: {
    ingredientId: string;
    type: IngredientStockLogType;
    quantity: number;
    note?: string;
  }) {
    const quantity = Math.abs(toFixedQuantity(payload.quantity));
    if (quantity <= 0) {
      return null;
    }

    const log = this.stockLogRepository.create({
      ingredientId: payload.ingredientId,
      type: payload.type,
      quantity,
      note: payload.note ?? null
    });

    return this.stockLogRepository.save(log);
  }

  private async getOrCreateStockByIngredientId(ingredientId: string) {
    const existing = await this.stockRepository.findOne({ where: { ingredientId } });
    if (existing) {
      return existing;
    }

    const created = this.stockRepository.create({
      ingredientId,
      totalStock: 0,
      lastUpdatedAt: new Date()
    });

    return this.stockRepository.save(created);
  }

  private async getCategoryIngredientCountMap(categoryIds: string[]) {
    if (!categoryIds.length) {
      return new Map<string, number>();
    }

    const rows = await this.ingredientRepository
      .createQueryBuilder("ingredient")
      .select("ingredient.categoryId", "categoryId")
      .addSelect("COUNT(*)", "count")
      .where("ingredient.categoryId IN (:...categoryIds)", { categoryIds })
      .groupBy("ingredient.categoryId")
      .getRawMany<{ categoryId: string; count: string }>();

    return new Map(rows.map((row) => [row.categoryId, Number(row.count)]));
  }

  private mapCategorySummary(category: IngredientCategory, ingredientCount: number) {
    return {
      id: category.id,
      name: category.name,
      description: category.description,
      isActive: category.isActive,
      ingredientCount,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt
    };
  }

  async listCategories(filters: CategoryListFilters) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(50, Math.max(1, filters.limit || 10));
    const offset = (page - 1) * limit;

    const query = this.categoryRepository
      .createQueryBuilder("category")
      .where("1 = 1")
      .orderBy("category.createdAt", "DESC");

    if (!filters.includeInactive) {
      query.andWhere("category.isActive = true");
    }

    if (filters.search) {
      query.andWhere("LOWER(category.name) LIKE LOWER(:search)", {
        search: `%${filters.search}%`
      });
    }

    const total = await query.getCount();
    const categories = await query.offset(offset).limit(limit).getMany();
    const categoryIds = categories.map((category) => category.id);
    const countMap = await this.getCategoryIngredientCountMap(categoryIds);

    return {
      categories: categories.map((category) =>
        this.mapCategorySummary(category, countMap.get(category.id) ?? 0)
      ),
      pagination: getPaginationMeta(page, limit, total)
    };
  }

  async createCategory(payload: { name: string; description?: string }) {
    const normalizedName = payload.name.trim();
    const exists = await this.categoryRepository
      .createQueryBuilder("category")
      .where("LOWER(category.name) = LOWER(:name)", { name: normalizedName })
      .getOne();

    if (exists) {
      throw new AppError(409, "Category with this name already exists");
    }

    const category = this.categoryRepository.create({
      name: normalizedName,
      description: payload.description?.trim() || null,
      isActive: true
    });

    const saved = await this.categoryRepository.save(category);
    return this.mapCategorySummary(saved, 0);
  }

  async updateCategory(id: string, payload: { name?: string; description?: string; isActive?: boolean }) {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new AppError(404, "Ingredient category not found");
    }

    if (payload.name) {
      const normalizedName = payload.name.trim();
      const duplicate = await this.categoryRepository
        .createQueryBuilder("category")
        .where("LOWER(category.name) = LOWER(:name)", { name: normalizedName })
        .andWhere("category.id != :id", { id })
        .getOne();

      if (duplicate) {
        throw new AppError(409, "Category with this name already exists");
      }
      category.name = normalizedName;
    }

    if (payload.description !== undefined) {
      category.description = payload.description.trim() || null;
    }

    if (payload.isActive !== undefined) {
      category.isActive = payload.isActive;
    }

    const saved = await this.categoryRepository.save(category);
    const countMap = await this.getCategoryIngredientCountMap([saved.id]);
    return this.mapCategorySummary(saved, countMap.get(saved.id) ?? 0);
  }

  async deleteCategory(id: string) {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new AppError(404, "Ingredient category not found");
    }

    const ingredientCount = await this.ingredientRepository.count({
      where: { categoryId: id }
    });

    if (ingredientCount > 0) {
      throw new AppError(409, "Cannot delete category with existing ingredients");
    }

    await this.categoryRepository.remove(category);
    return this.mapCategorySummary(category, 0);
  }

  async listIngredients(filters: IngredientListFilters) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(50, Math.max(1, filters.limit || 10));
    const offset = (page - 1) * limit;

    const query = this.ingredientRepository
      .createQueryBuilder("ingredient")
      .leftJoinAndSelect("ingredient.category", "category")
      .where("1 = 1")
      .orderBy("ingredient.createdAt", "DESC");

    if (!filters.includeInactive) {
      query.andWhere("ingredient.isActive = true");
    }

    if (filters.search) {
      query.andWhere("LOWER(ingredient.name) LIKE LOWER(:search)", {
        search: `%${filters.search}%`
      });
    }

    if (filters.categoryId) {
      query.andWhere("ingredient.categoryId = :categoryId", { categoryId: filters.categoryId });
    }

    const total = await query.getCount();
    const ingredients = await query.offset(offset).limit(limit).getMany();

    const ingredientIds = ingredients.map((ingredient) => ingredient.id);
    const stocks = ingredientIds.length
      ? await this.stockRepository.find({
          where: { ingredientId: In(ingredientIds) }
        })
      : [];

    const stockMap = new Map(stocks.map((stock) => [stock.ingredientId, getNumericValue(stock.totalStock)]));

    return {
      ingredients: ingredients.map((ingredient) => {
        const totalStock = toFixedQuantity(stockMap.get(ingredient.id) ?? 0);
        const minStock = toFixedQuantity(getNumericValue(ingredient.minStock));

        return {
          id: ingredient.id,
          name: ingredient.name,
          categoryId: ingredient.categoryId,
          categoryName: ingredient.category.name,
          unit: ingredient.unit,
          perUnitPrice: toFixedQuantity(getNumericValue(ingredient.perUnitPrice)),
          minStock,
          totalStock,
          isActive: ingredient.isActive,
          status: getStockStatus(totalStock, minStock),
          createdAt: ingredient.createdAt,
          updatedAt: ingredient.updatedAt
        };
      }),
      pagination: getPaginationMeta(page, limit, total)
    };
  }

  async createIngredient(payload: {
    name: string;
    categoryId: string;
    unit: IngredientUnit;
    perUnitPrice: number;
    minStock: number;
    currentStock?: number;
  }) {
    await this.getActiveCategoryOrFail(payload.categoryId);

    const normalizedName = payload.name.trim();
    const exists = await this.ingredientRepository
      .createQueryBuilder("ingredient")
      .where("LOWER(ingredient.name) = LOWER(:name)", { name: normalizedName })
      .getOne();

    if (exists) {
      throw new AppError(409, "Ingredient with this name already exists");
    }

    const ingredient = this.ingredientRepository.create({
      name: normalizedName,
      categoryId: payload.categoryId,
      unit: payload.unit,
      perUnitPrice: toFixedQuantity(payload.perUnitPrice),
      minStock: toFixedQuantity(payload.minStock),
      isActive: true
    });

    const saved = await this.ingredientRepository.save(ingredient);
    const initialStock = toFixedQuantity(payload.currentStock ?? 0);

    const stock = this.stockRepository.create({
      ingredientId: saved.id,
      totalStock: initialStock,
      lastUpdatedAt: new Date()
    });
    await this.stockRepository.save(stock);

    await this.createStockLog({
      ingredientId: saved.id,
      type: IngredientStockLogType.ADD,
      quantity: initialStock,
      note: initialStock > 0 ? "Initial stock set during ingredient creation." : undefined
    });

    return saved;
  }

  async updateIngredient(
    id: string,
    payload: {
      name?: string;
      categoryId?: string;
      unit?: IngredientUnit;
      perUnitPrice?: number;
      minStock?: number;
      currentStock?: number;
      isActive?: boolean;
    }
  ) {
    const ingredient = await this.ingredientRepository.findOne({
      where: { id },
      relations: { category: true }
    });
    if (!ingredient) {
      throw new AppError(404, "Ingredient not found");
    }

    if (payload.name) {
      const normalizedName = payload.name.trim();
      const duplicate = await this.ingredientRepository
        .createQueryBuilder("ingredient")
        .where("LOWER(ingredient.name) = LOWER(:name)", { name: normalizedName })
        .andWhere("ingredient.id != :id", { id })
        .getOne();

      if (duplicate) {
        throw new AppError(409, "Ingredient with this name already exists");
      }

      ingredient.name = normalizedName;
    }

    if (payload.categoryId) {
      await this.getActiveCategoryOrFail(payload.categoryId);
      ingredient.categoryId = payload.categoryId;
    }

    if (payload.unit) {
      ingredient.unit = payload.unit;
    }

    if (payload.perUnitPrice !== undefined) {
      ingredient.perUnitPrice = toFixedQuantity(payload.perUnitPrice);
    }

    if (payload.minStock !== undefined) {
      ingredient.minStock = toFixedQuantity(payload.minStock);
    }

    if (payload.isActive !== undefined) {
      ingredient.isActive = payload.isActive;
    }

    const saved = await this.ingredientRepository.save(ingredient);
    const stock = await this.getOrCreateStockByIngredientId(saved.id);

    if (payload.currentStock !== undefined) {
      const nextStock = toFixedQuantity(payload.currentStock);
      const currentStock = toFixedQuantity(getNumericValue(stock.totalStock));
      const adjustment = toFixedQuantity(nextStock - currentStock);

      if (adjustment !== 0) {
        stock.totalStock = nextStock;
        stock.lastUpdatedAt = new Date();
        await this.stockRepository.save(stock);

        await this.createStockLog({
          ingredientId: saved.id,
          type: IngredientStockLogType.ADJUST,
          quantity: adjustment,
          note: "Stock updated from ingredient edit."
        });
      }
    }

    return saved;
  }

  async deleteIngredient(id: string) {
    const ingredient = await this.ingredientRepository.findOne({
      where: { id }
    });

    if (!ingredient) {
      throw new AppError(404, "Ingredient not found");
    }

    const [itemUsageCount, addOnUsageCount] = await Promise.all([
      this.itemIngredientRepository.count({ where: { ingredientId: id } }),
      this.addOnIngredientRepository.count({ where: { ingredientId: id } })
    ]);

    if (itemUsageCount + addOnUsageCount > 0) {
      throw new AppError(
        409,
        `Cannot delete this ingredient because it is used in ${itemUsageCount} item recipe(s) and ${addOnUsageCount} add-on recipe(s).`
      );
    }

    try {
      await this.ingredientRepository.remove(ingredient);
      return ingredient;
    } catch (error) {
      if (error instanceof QueryFailedError) {
        throw new AppError(
          409,
          "Cannot delete this ingredient because it is linked to existing records."
        );
      }
      throw error;
    }
  }

  async getIngredientStock(ingredientId: string, filters: StockLogListFilters) {
    const ingredient = await this.getActiveIngredientOrFail(ingredientId);
    const stock = await this.getOrCreateStockByIngredientId(ingredientId);

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 10));
    const offset = (page - 1) * limit;

    const logQuery = this.stockLogRepository
      .createQueryBuilder("log")
      .where("log.ingredientId = :ingredientId", { ingredientId })
      .orderBy("log.createdAt", "DESC");

    const total = await logQuery.getCount();
    const logs = await logQuery.offset(offset).limit(limit).getMany();

    const totalStock = toFixedQuantity(getNumericValue(stock.totalStock));
    const minStock = toFixedQuantity(getNumericValue(ingredient.minStock));
    const perUnitPrice = toFixedQuantity(getNumericValue(ingredient.perUnitPrice));
    const totalValuation = toFixedQuantity(totalStock * perUnitPrice);

    return {
      stock: {
        ingredientId,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        perUnitPrice,
        totalValuation,
        totalStock,
        minStock,
        status: getStockStatus(totalStock, minStock),
        lastUpdatedAt: stock.lastUpdatedAt
      },
      logs: logs.map((log) => ({
        id: log.id,
        type: log.type,
        quantity: toFixedQuantity(getNumericValue(log.quantity)),
        note: log.note,
        createdAt: log.createdAt
      })),
      pagination: getPaginationMeta(page, limit, total)
    };
  }

  async addStock(ingredientId: string, payload: { quantity: number; note?: string }) {
    await this.getActiveIngredientOrFail(ingredientId);
    const quantity = toFixedQuantity(payload.quantity);
    if (quantity <= 0) {
      throw new AppError(422, "Quantity must be greater than zero");
    }

    const stock = await this.getOrCreateStockByIngredientId(ingredientId);
    const current = getNumericValue(stock.totalStock);
    stock.totalStock = toFixedQuantity(current + quantity);
    stock.lastUpdatedAt = new Date();
    const savedStock = await this.stockRepository.save(stock);

    await this.createStockLog({
      ingredientId,
      type: IngredientStockLogType.ADD,
      quantity,
      note: payload.note
    });

    return {
      ingredientId,
      totalStock: toFixedQuantity(getNumericValue(savedStock.totalStock)),
      lastUpdatedAt: savedStock.lastUpdatedAt
    };
  }

  async adjustStock(ingredientId: string, payload: { quantity: number; note?: string }) {
    await this.getActiveIngredientOrFail(ingredientId);
    const quantity = toFixedQuantity(payload.quantity);
    if (quantity === 0) {
      throw new AppError(422, "Adjustment quantity cannot be zero");
    }

    const stock = await this.getOrCreateStockByIngredientId(ingredientId);
    const current = getNumericValue(stock.totalStock);
    const next = toFixedQuantity(current + quantity);

    if (next < 0) {
      throw new AppError(409, "Stock cannot be negative after adjustment");
    }

    stock.totalStock = next;
    stock.lastUpdatedAt = new Date();
    const savedStock = await this.stockRepository.save(stock);

    await this.createStockLog({
      ingredientId,
      type: IngredientStockLogType.ADJUST,
      quantity,
      note: payload.note
    });

    return {
      ingredientId,
      totalStock: toFixedQuantity(getNumericValue(savedStock.totalStock)),
      lastUpdatedAt: savedStock.lastUpdatedAt
    };
  }

  async getAllocations(filters: AllocationListFilters) {
    const targetDate = filters.date || getTodayDateString();
    const isOverall = Boolean(filters.overall);
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(50, Math.max(1, filters.limit || 10));
    const offset = (page - 1) * limit;

    const ingredientQuery = this.ingredientRepository
      .createQueryBuilder("ingredient")
      .leftJoinAndSelect("ingredient.category", "category")
      .where("ingredient.isActive = true")
      .orderBy("ingredient.name", "ASC");

    if (filters.search) {
      ingredientQuery.andWhere("LOWER(ingredient.name) LIKE LOWER(:search)", {
        search: `%${filters.search}%`
      });
    }

    if (filters.categoryId) {
      ingredientQuery.andWhere("ingredient.categoryId = :categoryId", { categoryId: filters.categoryId });
    }

    const total = await ingredientQuery.getCount();
    const ingredients = await ingredientQuery.offset(offset).limit(limit).getMany();

    const ingredientIds = ingredients.map((ingredient) => ingredient.id);
    const [stocks, allocationRows, usageRows] = await Promise.all([
      ingredientIds.length
        ? this.stockRepository.find({
            where: { ingredientId: In(ingredientIds) }
          })
        : Promise.resolve([]),
      ingredientIds.length
        ? isOverall
          ? this.allocationRepository
              .createQueryBuilder("allocation")
              .select("allocation.ingredientId", "ingredientId")
              .addSelect("SUM(allocation.allocatedQuantity)", "allocatedQuantity")
              .addSelect("SUM(allocation.usedQuantity)", "usedQuantity")
              .addSelect("SUM(allocation.remainingQuantity)", "remainingQuantity")
              .where("allocation.ingredientId IN (:...ingredientIds)", { ingredientIds })
              .groupBy("allocation.ingredientId")
              .getRawMany<{
                ingredientId: string;
                allocatedQuantity: string;
                usedQuantity: string;
                remainingQuantity: string;
              }>()
          : this.allocationRepository.find({
              where: { ingredientId: In(ingredientIds), date: targetDate }
            })
        : Promise.resolve([]),
      ingredientIds.length
        ? this.usageEventRepository
            .createQueryBuilder("event")
            .select("event.ingredientId", "ingredientId")
            .addSelect("SUM(event.consumedQuantity)", "usedQuantity")
            .where("event.ingredientId IN (:...ingredientIds)", { ingredientIds })
            .andWhere(isOverall ? "1 = 1" : "event.usageDate = :date", isOverall ? {} : { date: targetDate })
            .groupBy("event.ingredientId")
            .getRawMany<{ ingredientId: string; usedQuantity: string }>()
        : Promise.resolve([])
    ]);

    const stockMap = new Map(stocks.map((stock) => [stock.ingredientId, getNumericValue(stock.totalStock)]));
    const allocationMap = isOverall
      ? new Map(
          (allocationRows as Array<{
            ingredientId: string;
            allocatedQuantity: string;
            usedQuantity: string;
            remainingQuantity: string;
          }>).map((allocation) => [
            allocation.ingredientId,
            {
              id: null,
              allocatedQuantity: getNumericValue(allocation.allocatedQuantity),
              usedQuantity: getNumericValue(allocation.usedQuantity),
              remainingQuantity: getNumericValue(allocation.remainingQuantity)
            }
          ])
        )
      : new Map(
          (allocationRows as DailyAllocation[]).map((allocation) => [
            allocation.ingredientId,
            {
              id: allocation.id,
              allocatedQuantity: getNumericValue(allocation.allocatedQuantity),
              usedQuantity: getNumericValue(allocation.usedQuantity),
              remainingQuantity: getNumericValue(allocation.remainingQuantity)
            }
          ])
        );
    const usageMap = new Map(usageRows.map((row) => [row.ingredientId, getNumericValue(row.usedQuantity)]));

    return {
      rows: ingredients.map((ingredient) => {
        const stockValue = toFixedQuantity(stockMap.get(ingredient.id) ?? 0);
        const allocation = allocationMap.get(ingredient.id);
        const allocatedQuantity = toFixedQuantity(getNumericValue(allocation?.allocatedQuantity));
        const allocationUsed = toFixedQuantity(getNumericValue(allocation?.usedQuantity));
        const usageUsed = toFixedQuantity(usageMap.get(ingredient.id) ?? 0);
        const usedQuantity = toFixedQuantity(Math.max(allocationUsed, usageUsed));
        const remainingQuantity = toFixedQuantity(Math.max(allocatedQuantity - usedQuantity, 0));
        const minStock = toFixedQuantity(getNumericValue(ingredient.minStock));

        return {
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          categoryId: ingredient.categoryId,
          categoryName: ingredient.category.name,
          unit: ingredient.unit,
          totalStock: stockValue,
          minStock,
          allocatedQuantity,
          usedQuantity,
          remainingQuantity,
          allocationId: allocation?.id ?? null,
          status: getStockStatus(stockValue, minStock),
          date: isOverall ? "overall" : targetDate
        };
      }),
      pagination: getPaginationMeta(page, limit, total)
    };
  }

  async getAllocationStats(filters: AllocationStatsFilters) {
    const targetDate = filters.date || getTodayDateString();
    const ingredientQuery = this.ingredientRepository
      .createQueryBuilder("ingredient")
      .leftJoinAndSelect("ingredient.category", "category")
      .where("ingredient.isActive = true")
      .orderBy("ingredient.name", "ASC");

    if (filters.search) {
      ingredientQuery.andWhere("LOWER(ingredient.name) LIKE LOWER(:search)", {
        search: `%${filters.search}%`
      });
    }

    if (filters.categoryId) {
      ingredientQuery.andWhere("ingredient.categoryId = :categoryId", { categoryId: filters.categoryId });
    }

    const ingredients = await ingredientQuery.getMany();

    const ingredientIds = ingredients.map((ingredient) => ingredient.id);
    const [stocks, allocationTotalsRows, usageRows, staffUsageRows, recentAllocations] = await Promise.all([
      ingredientIds.length
        ? this.stockRepository.find({
            where: { ingredientId: In(ingredientIds) }
          })
        : Promise.resolve([]),
      ingredientIds.length
        ? this.allocationRepository
            .createQueryBuilder("allocation")
            .select("allocation.ingredientId", "ingredientId")
            .addSelect("SUM(allocation.allocatedQuantity)", "allocatedQuantity")
            .addSelect("SUM(allocation.usedQuantity)", "usedQuantity")
            .addSelect("SUM(allocation.remainingQuantity)", "remainingQuantity")
            .where("allocation.ingredientId IN (:...ingredientIds)", { ingredientIds })
            .groupBy("allocation.ingredientId")
            .getRawMany<{
              ingredientId: string;
              allocatedQuantity: string;
              usedQuantity: string;
              remainingQuantity: string;
            }>()
        : Promise.resolve([]),
      ingredientIds.length
        ? this.usageEventRepository
            .createQueryBuilder("event")
            .select("event.ingredientId", "ingredientId")
            .addSelect("SUM(event.consumedQuantity)", "usedQuantity")
            .addSelect("SUM(event.overusedQuantity)", "overusedQuantity")
            .where("event.ingredientId IN (:...ingredientIds)", { ingredientIds })
            .groupBy("event.ingredientId")
            .getRawMany<{ ingredientId: string; usedQuantity: string; overusedQuantity: string }>()
        : Promise.resolve([]),
      ingredientIds.length
        ? this.usageEventRepository
            .createQueryBuilder("event")
            .leftJoin("event.staff", "staff")
            .select("COALESCE(CAST(event.staffId AS text), 'unknown')", "staffId")
            .addSelect("COALESCE(staff.fullName, 'Unknown Staff')", "staffName")
            .addSelect("COUNT(DISTINCT event.ingredientId)", "ingredientCount")
            .addSelect("SUM(event.consumedQuantity)", "consumedQuantity")
            .where("event.ingredientId IN (:...ingredientIds)", { ingredientIds })
            .groupBy("event.staffId")
            .addGroupBy("staff.fullName")
            .orderBy("SUM(event.consumedQuantity)", "DESC")
            .getRawMany<{
              staffId: string;
              staffName: string;
              ingredientCount: string;
              consumedQuantity: string;
            }>()
        : Promise.resolve([]),
      ingredientIds.length
        ? this.allocationRepository.find({
            where: { ingredientId: In(ingredientIds) },
            relations: { ingredient: { category: true } },
            order: { updatedAt: "DESC" },
            take: 6
          })
        : Promise.resolve([])
    ]);

    const stockMap = new Map(stocks.map((stock) => [stock.ingredientId, getNumericValue(stock.totalStock)]));
    const allocationTotalsMap = new Map(
      allocationTotalsRows.map((row) => [
        row.ingredientId,
        {
          allocatedQuantity: getNumericValue(row.allocatedQuantity),
          usedQuantity: getNumericValue(row.usedQuantity),
          remainingQuantity: getNumericValue(row.remainingQuantity)
        }
      ])
    );
    const usageMap = new Map(
      usageRows.map((row) => [
        row.ingredientId,
        {
          usedQuantity: getNumericValue(row.usedQuantity),
          overusedQuantity: getNumericValue(row.overusedQuantity)
        }
      ])
    );

    let allocatedIngredients = 0;
    let missingAllocationIngredients = 0;
    let lowStockIngredients = 0;
    let healthyStockIngredients = 0;
    let totalStock = 0;
    let totalAllocated = 0;
    let totalUsed = 0;
    let totalRemaining = 0;
    let totalValuation = 0;
    let totalOverused = 0;

    const categoryMetrics = new Map<
      string,
      { categoryName: string; totalStock: number; allocated: number; used: number; remaining: number }
    >();

    let highestValuationIngredient: {
      ingredientId: string;
      ingredientName: string;
      unit: IngredientUnit;
      valuation: number;
      totalStock: number;
    } | null = null;

    let mostUsedIngredient: {
      ingredientId: string;
      ingredientName: string;
      unit: IngredientUnit;
      usedQuantity: number;
    } | null = null;

    for (const ingredient of ingredients) {
      const stockValue = toFixedQuantity(stockMap.get(ingredient.id) ?? 0);
      const minStock = toFixedQuantity(getNumericValue(ingredient.minStock));
      const allocationTotals = allocationTotalsMap.get(ingredient.id);
      const allocationUsed = allocationTotals?.usedQuantity ?? 0;
      const usageUsed = usageMap.get(ingredient.id)?.usedQuantity ?? 0;
      const usedQuantity = toFixedQuantity(Math.max(allocationUsed, usageUsed));
      const allocatedQuantity = toFixedQuantity(allocationTotals?.allocatedQuantity ?? 0);
      const remainingQuantity = toFixedQuantity(Math.max(allocatedQuantity - usedQuantity, 0));
      const overusedQuantity = toFixedQuantity(usageMap.get(ingredient.id)?.overusedQuantity ?? 0);
      const valuation = toFixedQuantity(stockValue * getNumericValue(ingredient.perUnitPrice));

      if (allocatedQuantity > 0) {
        allocatedIngredients += 1;
      } else {
        missingAllocationIngredients += 1;
      }

      if (stockValue <= minStock) {
        lowStockIngredients += 1;
      } else {
        healthyStockIngredients += 1;
      }

      totalStock += stockValue;
      totalAllocated += allocatedQuantity;
      totalUsed += usedQuantity;
      totalRemaining += remainingQuantity;
      totalValuation += valuation;
      totalOverused += overusedQuantity;

      if (!highestValuationIngredient || valuation > highestValuationIngredient.valuation) {
        highestValuationIngredient = {
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          unit: ingredient.unit,
          valuation,
          totalStock: stockValue
        };
      }

      if (!mostUsedIngredient || usedQuantity > mostUsedIngredient.usedQuantity) {
        mostUsedIngredient = {
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          unit: ingredient.unit,
          usedQuantity
        };
      }

      const categoryEntry = categoryMetrics.get(ingredient.categoryId) ?? {
        categoryName: ingredient.category.name,
        totalStock: 0,
        allocated: 0,
        used: 0,
        remaining: 0
      };
      categoryEntry.totalStock = toFixedQuantity(categoryEntry.totalStock + stockValue);
      categoryEntry.allocated = toFixedQuantity(categoryEntry.allocated + allocatedQuantity);
      categoryEntry.used = toFixedQuantity(categoryEntry.used + usedQuantity);
      categoryEntry.remaining = toFixedQuantity(categoryEntry.remaining + remainingQuantity);
      categoryMetrics.set(ingredient.categoryId, categoryEntry);
    }

    const recentUpdates = recentAllocations.map((allocation) => ({
      allocationId: allocation.id,
      ingredientId: allocation.ingredientId,
      ingredientName: allocation.ingredient.name,
      categoryName: allocation.ingredient.category.name,
      unit: allocation.ingredient.unit,
      allocatedQuantity: toFixedQuantity(getNumericValue(allocation.allocatedQuantity)),
      usedQuantity: toFixedQuantity(getNumericValue(allocation.usedQuantity)),
      remainingQuantity: toFixedQuantity(getNumericValue(allocation.remainingQuantity)),
      updatedAt: allocation.updatedAt
    }));

    const topUsedIngredients = [...ingredients]
      .map((ingredient) => ({
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        usedQuantity: toFixedQuantity(
          Math.max(allocationTotalsMap.get(ingredient.id)?.usedQuantity ?? 0, usageMap.get(ingredient.id)?.usedQuantity ?? 0)
        )
      }))
      .filter((entry) => entry.usedQuantity > 0)
      .sort((a, b) => b.usedQuantity - a.usedQuantity)
      .slice(0, 8);

    const staffUsageSummary = staffUsageRows.map((row) => ({
      staffId: row.staffId,
      staffName: row.staffName,
      ingredientCount: Number(row.ingredientCount),
      consumedQuantity: toFixedQuantity(getNumericValue(row.consumedQuantity))
    }));

    return {
      date: targetDate,
      totals: {
        totalIngredients: ingredients.length,
        allocatedIngredients,
        missingAllocationIngredients,
        lowStockIngredients,
        healthyStockIngredients
      },
      quantities: {
        totalStock: toFixedQuantity(totalStock),
        totalAllocated: toFixedQuantity(totalAllocated),
        totalUsed: toFixedQuantity(totalUsed),
        totalRemaining: toFixedQuantity(totalRemaining),
        totalValuation: toFixedQuantity(totalValuation),
        totalOverused: toFixedQuantity(totalOverused)
      },
      insights: {
        highestValuationIngredient,
        mostUsedIngredient,
        recentAllocationUpdates: recentUpdates,
        staffUsageSummary
      },
      charts: {
        statusBreakdown: [
          { label: "Low Stock", value: lowStockIngredients },
          { label: "Healthy Stock", value: healthyStockIngredients },
          { label: "No Allocation", value: missingAllocationIngredients }
        ],
        stockByCategory: [...categoryMetrics.values()].sort((a, b) =>
          a.categoryName.localeCompare(b.categoryName)
        ),
        topUsedIngredients
      }
    };
  }

  async assignAllStockToDate(payload: { date: string; note?: string }) {
    const targetDate = payload.date || getTodayDateString();
    const ingredients = await this.ingredientRepository.find({
      where: { isActive: true },
      order: { name: "ASC" }
    });

    const ingredientIds = ingredients.map((ingredient) => ingredient.id);
    if (!ingredientIds.length) {
      return {
        date: targetDate,
        summary: {
          allocatedCount: 0,
          skippedCount: 0,
          failedCount: 0
        },
        details: []
      };
    }

    const [stocks, allocations] = await Promise.all([
      this.stockRepository.find({
        where: { ingredientId: In(ingredientIds) }
      }),
      this.allocationRepository.find({
        where: { ingredientId: In(ingredientIds), date: targetDate }
      })
    ]);

    const stockMap = new Map(stocks.map((stock) => [stock.ingredientId, stock]));
    const allocationMap = new Map(allocations.map((allocation) => [allocation.ingredientId, allocation]));
    const details: Array<{
      ingredientId: string;
      ingredientName: string;
      allocatedQuantity: number;
      status: "allocated" | "skipped";
      message: string;
    }> = [];

    await AppDataSource.transaction(async (manager) => {
      for (const ingredient of ingredients) {
        const stock = stockMap.get(ingredient.id) ??
          manager.create(IngredientStock, {
            ingredientId: ingredient.id,
            totalStock: 0,
            lastUpdatedAt: new Date()
          });
        const availableStock = toFixedQuantity(getNumericValue(stock.totalStock));

        if (availableStock <= 0) {
          details.push({
            ingredientId: ingredient.id,
            ingredientName: ingredient.name,
            allocatedQuantity: 0,
            status: "skipped",
            message: "No available stock to allocate"
          });
          continue;
        }

        const existing = allocationMap.get(ingredient.id);
        if (existing) {
          const used = toFixedQuantity(getNumericValue(existing.usedQuantity));
          const nextAllocated = toFixedQuantity(getNumericValue(existing.allocatedQuantity) + availableStock);
          existing.allocatedQuantity = nextAllocated;
          existing.remainingQuantity = toFixedQuantity(Math.max(nextAllocated - used, 0));
          await manager.save(DailyAllocation, existing);
        } else {
          const created = manager.create(DailyAllocation, {
            ingredientId: ingredient.id,
            date: targetDate,
            allocatedQuantity: availableStock,
            usedQuantity: 0,
            remainingQuantity: availableStock
          });
          await manager.save(DailyAllocation, created);
        }

        stock.totalStock = 0;
        stock.lastUpdatedAt = new Date();
        await manager.save(IngredientStock, stock);

        const log = manager.create(IngredientStockLog, {
          ingredientId: ingredient.id,
          type: IngredientStockLogType.ALLOCATE,
          quantity: availableStock,
          note: payload.note ?? "Allocated using assign all stock action."
        });
        await manager.save(IngredientStockLog, log);

        details.push({
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          allocatedQuantity: availableStock,
          status: "allocated",
          message: "Allocated successfully"
        });
      }
    });

    const allocatedCount = details.filter((entry) => entry.status === "allocated").length;
    const skippedCount = details.filter((entry) => entry.status === "skipped").length;

    return {
      date: targetDate,
      summary: {
        allocatedCount,
        skippedCount,
        failedCount: 0
      },
      details
    };
  }

  async continueYesterdayAllocation(payload: { date: string; note?: string }) {
    const targetDate = payload.date || getTodayDateString();
    const previousDate = getPreviousDateString(targetDate);

    const previousAllocations = await this.allocationRepository.find({
      where: { date: previousDate },
      relations: { ingredient: true },
      order: { updatedAt: "DESC" }
    });

    if (!previousAllocations.length) {
      return {
        date: targetDate,
        previousDate,
        summary: {
          copiedCount: 0,
          partialCount: 0,
          skippedCount: 0
        },
        details: []
      };
    }

    const ingredientIds = previousAllocations.map((allocation) => allocation.ingredientId);
    const [todayAllocations] = await Promise.all([
      this.allocationRepository.find({
        where: { ingredientId: In(ingredientIds), date: targetDate }
      })
    ]);

    const todayMap = new Map(todayAllocations.map((allocation) => [allocation.ingredientId, allocation]));
    const details: Array<{
      ingredientId: string;
      ingredientName: string;
      copiedQuantity: number;
      requestedQuantity: number;
      status: "copied" | "partial" | "skipped";
      message: string;
    }> = [];

    await AppDataSource.transaction(async (manager) => {
      for (const previous of previousAllocations) {
        const requestedQuantity = toFixedQuantity(getNumericValue(previous.remainingQuantity));
        if (requestedQuantity <= 0) {
          details.push({
            ingredientId: previous.ingredientId,
            ingredientName: previous.ingredient.name,
            copiedQuantity: 0,
            requestedQuantity,
            status: "skipped",
            message: "Yesterday has no remaining quantity to carry forward"
          });
          continue;
        }

        const existingToday = todayMap.get(previous.ingredientId);
        if (existingToday) {
          const canOverwriteZeroAllocation =
            toFixedQuantity(getNumericValue(existingToday.allocatedQuantity)) <= 0 &&
            toFixedQuantity(getNumericValue(existingToday.usedQuantity)) <= 0 &&
            toFixedQuantity(getNumericValue(existingToday.remainingQuantity)) <= 0;

          if (!canOverwriteZeroAllocation) {
            details.push({
              ingredientId: previous.ingredientId,
              ingredientName: previous.ingredient.name,
              copiedQuantity: 0,
              requestedQuantity,
              status: "skipped",
              message: "Today allocation already exists"
            });
            continue;
          }

          existingToday.allocatedQuantity = requestedQuantity;
          existingToday.usedQuantity = 0;
          existingToday.remainingQuantity = requestedQuantity;
          await manager.save(DailyAllocation, existingToday);

          await manager.save(
            IngredientStockLog,
            manager.create(IngredientStockLog, {
              ingredientId: previous.ingredientId,
              type: IngredientStockLogType.ADJUST,
              quantity: requestedQuantity,
              note:
                payload.note ??
                `Carry-forward allocation from ${previousDate} remaining balance. Updated existing zero allocation.`
            })
          );

          details.push({
            ingredientId: previous.ingredientId,
            ingredientName: previous.ingredient.name,
            copiedQuantity: requestedQuantity,
            requestedQuantity,
            status: "copied",
            message: "Remaining quantity carried forward into existing zero allocation"
          });
          continue;
        }

        const copiedQuantity = requestedQuantity;
        const allocation = manager.create(DailyAllocation, {
          ingredientId: previous.ingredientId,
          date: targetDate,
          allocatedQuantity: copiedQuantity,
          usedQuantity: 0,
          remainingQuantity: copiedQuantity
        });
        await manager.save(DailyAllocation, allocation);

        await manager.save(
          IngredientStockLog,
          manager.create(IngredientStockLog, {
            ingredientId: previous.ingredientId,
            type: IngredientStockLogType.ADJUST,
            quantity: copiedQuantity,
            note:
              payload.note ??
              `Carry-forward allocation from ${previousDate} remaining balance. No central stock deduction.`
          })
        );

        details.push({
          ingredientId: previous.ingredientId,
          ingredientName: previous.ingredient.name,
          copiedQuantity,
          requestedQuantity,
          status: "copied",
          message: "Remaining quantity carried forward successfully"
        });
      }
    });

    return {
      date: targetDate,
      previousDate,
      summary: {
        copiedCount: details.filter((entry) => entry.status === "copied").length,
        partialCount: 0,
        skippedCount: details.filter((entry) => entry.status === "skipped").length
      },
      details
    };
  }

  private async getOrCreatePosBillingControl() {
    const existing = await this.posBillingControlRepository.findOne({
      where: {},
      order: { updatedAt: "DESC" },
      relations: { updatedByUser: true }
    });

    if (existing) {
      return existing;
    }

    const created = this.posBillingControlRepository.create({
      isBillingEnabled: true,
      enforceDailyAllocation: true,
      reason: null,
      updatedByUserId: null
    });
    return this.posBillingControlRepository.save(created);
  }

  private async getClosingDraftItems(reportDate: string) {
    const ingredients = await this.ingredientRepository.find({
      where: { isActive: true },
      relations: { category: true },
      order: { name: "ASC" }
    });

    const ingredientIds = ingredients.map((ingredient) => ingredient.id);
    if (!ingredientIds.length) {
      return [];
    }

    const [allocations, usageRows] = await Promise.all([
      this.allocationRepository.find({
        where: { ingredientId: In(ingredientIds), date: reportDate }
      }),
      this.usageEventRepository
        .createQueryBuilder("usage")
        .select("usage.ingredientId", "ingredientId")
        .addSelect("SUM(usage.consumedQuantity)", "usedQuantity")
        .where("usage.usageDate = :reportDate", { reportDate })
        .andWhere("usage.ingredientId IS NOT NULL")
        .groupBy("usage.ingredientId")
        .getRawMany<{ ingredientId: string; usedQuantity: string }>()
    ]);

    const allocationMap = new Map(allocations.map((allocation) => [allocation.ingredientId, allocation]));
    const usageMap = new Map(
      usageRows.map((row) => [row.ingredientId, toFixedQuantity(getNumericValue(row.usedQuantity))])
    );

    return ingredients.map((ingredient) => {
      const allocation = allocationMap.get(ingredient.id);
      const allocatedQuantity = toFixedQuantity(getNumericValue(allocation?.allocatedQuantity));
      const allocationUsed = toFixedQuantity(getNumericValue(allocation?.usedQuantity));
      const usageUsed = usageMap.get(ingredient.id) ?? 0;
      const usedQuantity = toFixedQuantity(Math.max(allocationUsed, usageUsed));
      const expectedRemainingQuantity = toFixedQuantity(Math.max(allocatedQuantity - usedQuantity, 0));

      return {
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        categoryName: ingredient.category.name,
        unit: ingredient.unit,
        allocatedQuantity,
        usedQuantity,
        expectedRemainingQuantity
      };
    });
  }

  private async resolveOrderGateStatus(userId: string) {
    const now = new Date();
    const today = getDateOnlyString(now);
    const previousDate = getPreviousDateString(today);
    const control = await this.getOrCreatePosBillingControl();

    const [reports, yesterdayUsageCount] = await Promise.all([
      this.closingReportRepository.find({
        where: {
          staffId: userId,
          reportDate: In([previousDate, today])
        }
      }),
      this.usageEventRepository
        .createQueryBuilder("usage")
        .where("usage.staffId = :staffId", { staffId: userId })
        .andWhere("usage.usageDate = :usageDate", { usageDate: previousDate })
        .getCount()
    ]);

    const hasClosedPreviousBusinessDate = reports.some((report) => report.reportDate === previousDate);
    const hasClosedTodayBusinessDate = reports.some((report) => report.reportDate === today);
    const pendingCarryForward = !hasClosedPreviousBusinessDate && yesterdayUsageCount > 0;

    const pendingCloseDate = pendingCarryForward ? previousDate : hasClosedTodayBusinessDate ? null : today;

    if (!control.isBillingEnabled) {
      return {
        canTakeOrders: false,
        reason: control.reason?.trim() || "POS billing is disabled by admin. Please contact administrator.",
        pendingCloseDate,
        hasClosedPreviousBusinessDate,
        hasClosedTodayBusinessDate,
        today,
        previousDate,
        control
      };
    }

    if (pendingCarryForward) {
      return {
        canTakeOrders: false,
        reason: `Previous business day (${previousDate}) closing is pending. Submit that closing first to continue billing.`,
        pendingCloseDate,
        hasClosedPreviousBusinessDate,
        hasClosedTodayBusinessDate,
        today,
        previousDate,
        control
      };
    }

    if (hasClosedTodayBusinessDate) {
      return {
        canTakeOrders: false,
        reason: "Today closing already submitted. Billing will unlock on the next business day.",
        pendingCloseDate,
        hasClosedPreviousBusinessDate,
        hasClosedTodayBusinessDate,
        today,
        previousDate,
        control
      };
    }

    return {
      canTakeOrders: true,
      reason: null as string | null,
      pendingCloseDate,
      hasClosedPreviousBusinessDate,
      hasClosedTodayBusinessDate,
      today,
      previousDate,
      control
    };
  }

  async getPosBillingControl() {
    const control = await this.getOrCreatePosBillingControl();
    return {
      isBillingEnabled: control.isBillingEnabled,
      enforceDailyAllocation: control.enforceDailyAllocation,
      reason: control.reason,
      updatedAt: control.updatedAt,
      updatedByUserId: control.updatedByUserId,
      updatedByName: control.updatedByUser?.fullName ?? null
    };
  }

  async updatePosBillingControl(payload: {
    isBillingEnabled?: boolean;
    enforceDailyAllocation?: boolean;
    reason?: string;
  }, updatedByUserId: string) {
    const control = await this.getOrCreatePosBillingControl();

    if (payload.isBillingEnabled !== undefined) {
      control.isBillingEnabled = payload.isBillingEnabled;
    }
    if (payload.enforceDailyAllocation !== undefined) {
      control.enforceDailyAllocation = payload.enforceDailyAllocation;
    }
    if (payload.reason !== undefined) {
      control.reason = payload.reason.trim() || null;
    }
    control.updatedByUserId = updatedByUserId;

    const saved = await this.posBillingControlRepository.save(control);
    return {
      isBillingEnabled: saved.isBillingEnabled,
      enforceDailyAllocation: saved.enforceDailyAllocation,
      reason: saved.reason,
      updatedAt: saved.updatedAt,
      updatedByUserId: saved.updatedByUserId
    };
  }

  async getClosingStatus(userId: string) {
    const gate = await this.resolveOrderGateStatus(userId);
    const [todaySubmissionCount, draftItems] = await Promise.all([
      this.closingReportRepository
        .createQueryBuilder("report")
        .where("report.staffId = :staffId", { staffId: userId })
        .andWhere("report.submittedAt BETWEEN :start AND :end", {
          start: getStartOfDay(new Date()),
          end: getEndOfDay(new Date())
        })
        .getCount(),
      this.getClosingDraftItems(gate.pendingCloseDate ?? gate.today)
    ]);

    return {
      canTakeOrders: gate.canTakeOrders,
      reason: gate.reason,
      pendingCloseDate: gate.pendingCloseDate,
      hasClosedPreviousBusinessDate: gate.hasClosedPreviousBusinessDate,
      hasClosedTodayBusinessDate: gate.hasClosedTodayBusinessDate,
      todayClosingCount: todaySubmissionCount,
      maxClosingsPerDay: 2,
      posBillingControl: {
        isBillingEnabled: gate.control.isBillingEnabled,
        enforceDailyAllocation: gate.control.enforceDailyAllocation,
        reason: gate.control.reason
      },
      draft: {
        reportDate: gate.pendingCloseDate ?? gate.today,
        rows: draftItems
      }
    };
  }

  async submitClosingReport(
    payload: {
      reportDate?: string;
      note?: string;
      rows: Array<{ ingredientId: string; reportedRemainingQuantity: number }>;
    },
    userId: string
  ) {
    const gate = await this.resolveOrderGateStatus(userId);
    const reportDate = payload.reportDate || gate.pendingCloseDate || gate.today;

    if (!gate.pendingCloseDate) {
      throw new AppError(409, "No pending closing found for submission right now.");
    }

    if (reportDate !== gate.pendingCloseDate) {
      throw new AppError(
        409,
        `Please submit pending closing for ${gate.pendingCloseDate} first before closing ${reportDate}.`
      );
    }

    const todaySubmissionCount = await this.closingReportRepository
      .createQueryBuilder("report")
      .where("report.staffId = :staffId", { staffId: userId })
      .andWhere("report.submittedAt BETWEEN :start AND :end", {
        start: getStartOfDay(new Date()),
        end: getEndOfDay(new Date())
      })
      .getCount();

    if (todaySubmissionCount >= 2) {
      throw new AppError(409, "Maximum 2 closings are allowed per day.");
    }

    const existing = await this.closingReportRepository.findOne({
      where: { staffId: userId, reportDate }
    });
    if (existing) {
      throw new AppError(409, `Closing for ${reportDate} is already submitted.`);
    }

    const draftItems = await this.getClosingDraftItems(reportDate);
    if (!draftItems.length) {
      throw new AppError(422, "No ingredient rows available for closing submission.");
    }

    const reportedMap = new Map<string, number>();
    payload.rows.forEach((row) => {
      reportedMap.set(row.ingredientId, toFixedQuantity(row.reportedRemainingQuantity));
    });

    const items = draftItems.map((entry) => {
      const reported =
        reportedMap.has(entry.ingredientId) ? reportedMap.get(entry.ingredientId)! : entry.expectedRemainingQuantity;

      if (reported < 0) {
        throw new AppError(422, `Reported remaining cannot be negative for ${entry.ingredientName}.`);
      }

      return {
        ingredientId: entry.ingredientId,
        ingredientName: entry.ingredientName,
        unit: entry.unit,
        allocatedQuantity: entry.allocatedQuantity,
        usedQuantity: entry.usedQuantity,
        expectedRemainingQuantity: entry.expectedRemainingQuantity,
        reportedRemainingQuantity: reported,
        varianceQuantity: toFixedQuantity(reported - entry.expectedRemainingQuantity)
      };
    });

    const totalExpectedRemaining = toFixedQuantity(
      items.reduce((sum, item) => sum + item.expectedRemainingQuantity, 0)
    );
    const totalReportedRemaining = toFixedQuantity(
      items.reduce((sum, item) => sum + item.reportedRemainingQuantity, 0)
    );
    const totalVariance = toFixedQuantity(totalReportedRemaining - totalExpectedRemaining);

    const report = this.closingReportRepository.create({
      staffId: userId,
      reportDate,
      closingSlot: todaySubmissionCount + 1,
      isCarryForwardClosing: reportDate === gate.previousDate,
      totalIngredients: items.length,
      totalExpectedRemaining,
      totalReportedRemaining,
      totalVariance,
      items,
      note: payload.note?.trim() || null
    });

    const saved = await this.closingReportRepository.save(report);
    const status = await this.getClosingStatus(userId);

    return {
      report: {
        id: saved.id,
        staffId: saved.staffId,
        reportDate: saved.reportDate,
        closingSlot: saved.closingSlot,
        isCarryForwardClosing: saved.isCarryForwardClosing,
        totalIngredients: saved.totalIngredients,
        totalExpectedRemaining: toFixedQuantity(getNumericValue(saved.totalExpectedRemaining)),
        totalReportedRemaining: toFixedQuantity(getNumericValue(saved.totalReportedRemaining)),
        totalVariance: toFixedQuantity(getNumericValue(saved.totalVariance)),
        note: saved.note,
        submittedAt: saved.submittedAt,
        items: saved.items
      },
      status
    };
  }

  async listClosingReports(filters: {
    date?: string;
    page: number;
    limit: number;
    staffId?: string;
  }, context: { userId: string; role: UserRole }) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(50, Math.max(1, filters.limit || 10));

    const query = this.closingReportRepository
      .createQueryBuilder("report")
      .leftJoinAndSelect("report.staff", "staff")
      .orderBy("report.submittedAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    if (filters.date) {
      query.andWhere("report.reportDate = :reportDate", { reportDate: filters.date });
    }

    if (context.role === UserRole.ADMIN || context.role === UserRole.MANAGER || context.role === UserRole.ACCOUNTANT) {
      if (filters.staffId) {
        query.andWhere("report.staffId = :staffId", { staffId: filters.staffId });
      }
    } else {
      query.andWhere("report.staffId = :staffId", { staffId: context.userId });
    }

    const [reports, total] = await query.getManyAndCount();
    return {
      reports: reports.map((report) => ({
        id: report.id,
        staffId: report.staffId,
        staffName: report.staff?.fullName ?? "-",
        reportDate: report.reportDate,
        closingSlot: report.closingSlot,
        isCarryForwardClosing: report.isCarryForwardClosing,
        totalIngredients: report.totalIngredients,
        totalExpectedRemaining: toFixedQuantity(getNumericValue(report.totalExpectedRemaining)),
        totalReportedRemaining: toFixedQuantity(getNumericValue(report.totalReportedRemaining)),
        totalVariance: toFixedQuantity(getNumericValue(report.totalVariance)),
        note: report.note,
        submittedAt: report.submittedAt
      })),
      pagination: getPaginationMeta(page, limit, total)
    };
  }

  async getStockAudit(filters: { date?: string; page: number; limit: number; staffId?: string }) {
    const targetDate = filters.date || getTodayDateString();
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 20));
    const offset = (page - 1) * limit;

    const query = this.closingReportRepository
      .createQueryBuilder("report")
      .leftJoinAndSelect("report.staff", "staff")
      .where("report.reportDate = :reportDate", { reportDate: targetDate })
      .orderBy("report.submittedAt", "DESC");

    if (filters.staffId) {
      query.andWhere("report.staffId = :staffId", { staffId: filters.staffId });
    }

    const reports = await query.getMany();
    const flattenedItems = reports.flatMap((report) =>
      (report.items ?? []).map((item) => ({
        reportId: report.id,
        reportDate: report.reportDate,
        staffId: report.staffId,
        staffName: report.staff?.fullName ?? "-",
        submittedAt: report.submittedAt,
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        unit: item.unit,
        allocatedQuantity: toFixedQuantity(getNumericValue(item.allocatedQuantity)),
        usedQuantity: toFixedQuantity(getNumericValue(item.usedQuantity)),
        expectedRemainingQuantity: toFixedQuantity(getNumericValue(item.expectedRemainingQuantity)),
        reportedRemainingQuantity: toFixedQuantity(getNumericValue(item.reportedRemainingQuantity)),
        varianceQuantity: toFixedQuantity(getNumericValue(item.varianceQuantity)),
        isMismatch: Math.abs(getNumericValue(item.varianceQuantity)) > 0.0001
      }))
    );

    const totalItems = flattenedItems.length;
    const pagedItems = flattenedItems.slice(offset, offset + limit);
    const totalExpected = toFixedQuantity(
      flattenedItems.reduce((sum, item) => sum + item.expectedRemainingQuantity, 0)
    );
    const totalReported = toFixedQuantity(
      flattenedItems.reduce((sum, item) => sum + item.reportedRemainingQuantity, 0)
    );
    const totalVarianceAbs = toFixedQuantity(
      flattenedItems.reduce((sum, item) => sum + Math.abs(item.varianceQuantity), 0)
    );
    const mismatchedIngredients = flattenedItems.filter((item) => item.isMismatch).length;
    const uniqueStaff = new Set(reports.map((report) => report.staffId));
    const control = await this.getOrCreatePosBillingControl();

    return {
      date: targetDate,
      stats: {
        totalReports: reports.length,
        staffSubmitted: uniqueStaff.size,
        totalIngredients: totalItems,
        mismatchedIngredients,
        matchedIngredients: Math.max(totalItems - mismatchedIngredients, 0),
        totalExpectedRemaining: totalExpected,
        totalReportedRemaining: totalReported,
        totalVarianceAbs
      },
      posBillingControl: {
        isBillingEnabled: control.isBillingEnabled,
        enforceDailyAllocation: control.enforceDailyAllocation,
        reason: control.reason,
        updatedAt: control.updatedAt
      },
      reports: reports.map((report) => ({
        id: report.id,
        staffId: report.staffId,
        staffName: report.staff?.fullName ?? "-",
        reportDate: report.reportDate,
        closingSlot: report.closingSlot,
        isCarryForwardClosing: report.isCarryForwardClosing,
        totalIngredients: report.totalIngredients,
        totalExpectedRemaining: toFixedQuantity(getNumericValue(report.totalExpectedRemaining)),
        totalReportedRemaining: toFixedQuantity(getNumericValue(report.totalReportedRemaining)),
        totalVariance: toFixedQuantity(getNumericValue(report.totalVariance)),
        note: report.note,
        submittedAt: report.submittedAt
      })),
      items: {
        rows: pagedItems,
        pagination: getPaginationMeta(page, limit, totalItems)
      }
    };
  }

  async saveAllocation(payload: { ingredientId: string; date: string; allocatedQuantity: number; note?: string }) {
    const ingredient = await this.getActiveIngredientOrFail(payload.ingredientId);
    const targetDate = payload.date || getTodayDateString();
    const requestedAllocation = toFixedQuantity(payload.allocatedQuantity);

    if (requestedAllocation < 0) {
      throw new AppError(422, "Allocated quantity cannot be negative");
    }

    const stock = await this.getOrCreateStockByIngredientId(payload.ingredientId);
    const existing = await this.allocationRepository.findOne({
      where: { ingredientId: payload.ingredientId, date: targetDate }
    });

    const currentStock = getNumericValue(stock.totalStock);

    if (existing) {
      const previousAllocated = getNumericValue(existing.allocatedQuantity);
      const usedQuantity = getNumericValue(existing.usedQuantity);
      const maxAllowed = toFixedQuantity(previousAllocated + currentStock);

      if (requestedAllocation < usedQuantity) {
        throw new AppError(422, "Allocated quantity cannot be less than used quantity");
      }

      if (requestedAllocation > maxAllowed) {
        throw new AppError(
          409,
          `Insufficient stock available. Maximum allocatable is ${maxAllowed} ${ingredient.unit} (current stock ${toFixedQuantity(currentStock)} ${ingredient.unit}).`
        );
      }

      const delta = toFixedQuantity(requestedAllocation - previousAllocated);

      stock.totalStock = toFixedQuantity(currentStock - delta);
      stock.lastUpdatedAt = new Date();
      await this.stockRepository.save(stock);

      existing.allocatedQuantity = requestedAllocation;
      existing.remainingQuantity = toFixedQuantity(requestedAllocation - usedQuantity);
      const saved = await this.allocationRepository.save(existing);

      await this.createStockLog({
        ingredientId: payload.ingredientId,
        type: IngredientStockLogType.ALLOCATE,
        quantity: delta,
        note: payload.note
      });

      return {
        id: saved.id,
        ingredientId: saved.ingredientId,
        ingredientName: ingredient.name,
        date: saved.date,
        allocatedQuantity: toFixedQuantity(getNumericValue(saved.allocatedQuantity)),
        usedQuantity: toFixedQuantity(getNumericValue(saved.usedQuantity)),
        remainingQuantity: toFixedQuantity(getNumericValue(saved.remainingQuantity))
      };
    }

    const maxAllowed = toFixedQuantity(currentStock);
    if (requestedAllocation > maxAllowed) {
      throw new AppError(
        409,
        `Insufficient stock available. Maximum allocatable is ${maxAllowed} ${ingredient.unit}.`
      );
    }

    stock.totalStock = toFixedQuantity(currentStock - requestedAllocation);
    stock.lastUpdatedAt = new Date();
    await this.stockRepository.save(stock);

    const allocation = this.allocationRepository.create({
      ingredientId: payload.ingredientId,
      date: targetDate,
      allocatedQuantity: requestedAllocation,
      usedQuantity: 0,
      remainingQuantity: requestedAllocation
    });

    const saved = await this.allocationRepository.save(allocation);

    await this.createStockLog({
      ingredientId: payload.ingredientId,
      type: IngredientStockLogType.ALLOCATE,
      quantity: requestedAllocation,
      note: payload.note
    });

    return {
      id: saved.id,
      ingredientId: saved.ingredientId,
      ingredientName: ingredient.name,
      date: saved.date,
      allocatedQuantity: toFixedQuantity(getNumericValue(saved.allocatedQuantity)),
      usedQuantity: toFixedQuantity(getNumericValue(saved.usedQuantity)),
      remainingQuantity: toFixedQuantity(getNumericValue(saved.remainingQuantity))
    };
  }

  async updateAllocation(
    id: string,
    payload: { allocatedQuantity?: number; usedQuantity?: number; note?: string }
  ) {
    const allocation = await this.allocationRepository.findOne({ where: { id } });
    if (!allocation) {
      throw new AppError(404, "Allocation record not found");
    }

    await this.getActiveIngredientOrFail(allocation.ingredientId);
    const stock = await this.getOrCreateStockByIngredientId(allocation.ingredientId);
    let currentStock = getNumericValue(stock.totalStock);

    let allocatedQuantity = getNumericValue(allocation.allocatedQuantity);
    let usedQuantity = getNumericValue(allocation.usedQuantity);

    if (payload.allocatedQuantity !== undefined) {
      const nextAllocated = toFixedQuantity(payload.allocatedQuantity);
      if (nextAllocated < 0) {
        throw new AppError(422, "Allocated quantity cannot be negative");
      }

      const candidateUsed = payload.usedQuantity !== undefined ? toFixedQuantity(payload.usedQuantity) : usedQuantity;
      if (nextAllocated < candidateUsed) {
        throw new AppError(422, "Allocated quantity cannot be less than used quantity");
      }

      const delta = toFixedQuantity(nextAllocated - allocatedQuantity);
      if (delta > currentStock) {
        throw new AppError(409, "Insufficient stock available");
      }

      currentStock = toFixedQuantity(currentStock - delta);
      allocatedQuantity = nextAllocated;

      await this.createStockLog({
        ingredientId: allocation.ingredientId,
        type: IngredientStockLogType.ALLOCATE,
        quantity: delta,
        note: payload.note
      });
    }

    if (payload.usedQuantity !== undefined) {
      const nextUsed = toFixedQuantity(payload.usedQuantity);
      if (nextUsed < 0) {
        throw new AppError(422, "Used quantity cannot be negative");
      }

      if (nextUsed > allocatedQuantity) {
        throw new AppError(422, "Used quantity cannot exceed allocated quantity");
      }

      const diffUsed = toFixedQuantity(nextUsed - usedQuantity);
      usedQuantity = nextUsed;

      await this.createStockLog({
        ingredientId: allocation.ingredientId,
        type: diffUsed >= 0 ? IngredientStockLogType.USE : IngredientStockLogType.ADJUST,
        quantity: diffUsed,
        note: payload.note
      });
    }

    stock.totalStock = toFixedQuantity(currentStock);
    stock.lastUpdatedAt = new Date();
    await this.stockRepository.save(stock);

    allocation.allocatedQuantity = toFixedQuantity(allocatedQuantity);
    allocation.usedQuantity = toFixedQuantity(usedQuantity);
    allocation.remainingQuantity = toFixedQuantity(allocatedQuantity - usedQuantity);
    const saved = await this.allocationRepository.save(allocation);

    return {
      id: saved.id,
      ingredientId: saved.ingredientId,
      date: saved.date,
      allocatedQuantity: toFixedQuantity(getNumericValue(saved.allocatedQuantity)),
      usedQuantity: toFixedQuantity(getNumericValue(saved.usedQuantity)),
      remainingQuantity: toFixedQuantity(getNumericValue(saved.remainingQuantity))
    };
  }
}
