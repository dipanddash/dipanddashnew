import { apiClient } from "@/lib/api-client";
import type { ApiSuccess } from "@/types/api";
import type {
  AllocationRow,
  IngredientAllocation,
  IngredientAllocationStats,
  IngredientCategory,
  IngredientListItem,
  IngredientStockDetails,
  IngredientStockLog,
  IngredientUnit,
  PaginationData,
  PosBillingControl,
  StockAuditData
} from "@/types/ingredient";

type CategoryListResponse = {
  categories: IngredientCategory[];
  pagination: PaginationData;
};

type IngredientListResponse = {
  ingredients: IngredientListItem[];
  pagination: PaginationData;
};

type StockResponse = {
  stock: IngredientStockDetails;
  logs: IngredientStockLog[];
  pagination: PaginationData;
};

type AllocationListResponse = {
  rows: AllocationRow[];
  pagination: PaginationData;
};

type AllocationStatsResponse = IngredientAllocationStats;
type StockAuditResponse = StockAuditData;

export const ingredientsService = {
  getPosBillingControl: async () => {
    const response = await apiClient.get<ApiSuccess<PosBillingControl>>("/ingredients/pos-billing-control");
    return response.data;
  },
  updatePosBillingControl: async (payload: {
    isBillingEnabled?: boolean;
    enforceDailyAllocation?: boolean;
    reason?: string;
  }) => {
    const response = await apiClient.patch<ApiSuccess<PosBillingControl>>(
      "/ingredients/pos-billing-control",
      payload
    );
    return response.data;
  },
  getCategories: async (params?: { search?: string; includeInactive?: boolean; page?: number; limit?: number }) => {
    const response = await apiClient.get<ApiSuccess<CategoryListResponse>>("/ingredients/categories", { params });
    return response.data;
  },
  createCategory: async (payload: { name: string; description?: string }) => {
    const response = await apiClient.post<ApiSuccess<{ category: IngredientCategory }>>(
      "/ingredients/categories",
      payload
    );
    return response.data;
  },
  updateCategory: async (id: string, payload: { name?: string; description?: string; isActive?: boolean }) => {
    const response = await apiClient.patch<ApiSuccess<{ category: IngredientCategory }>>(
      `/ingredients/categories/${id}`,
      payload
    );
    return response.data;
  },
  deleteCategory: async (id: string) => {
    const response = await apiClient.delete<ApiSuccess<{ category: IngredientCategory }>>(
      `/ingredients/categories/${id}`
    );
    return response.data;
  },
  getIngredients: async (params?: {
    search?: string;
    categoryId?: string;
    includeInactive?: boolean;
    page?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<ApiSuccess<IngredientListResponse>>("/ingredients", { params });
    return response.data;
  },
  createIngredient: async (payload: {
    name: string;
    categoryId: string;
    unit: IngredientUnit;
    perUnitPrice: number;
    minStock: number;
    currentStock: number;
  }) => {
    const response = await apiClient.post<ApiSuccess<{ ingredient: IngredientListItem }>>("/ingredients", payload);
    return response.data;
  },
  updateIngredient: async (
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
  ) => {
    const response = await apiClient.patch<ApiSuccess<{ ingredient: IngredientListItem }>>(
      `/ingredients/${id}`,
      payload
    );
    return response.data;
  },
  deleteIngredient: async (id: string) => {
    const response = await apiClient.delete<ApiSuccess<{ ingredient: IngredientListItem }>>(`/ingredients/${id}`);
    return response.data;
  },
  getIngredientStock: async (ingredientId: string, params?: { page?: number; limit?: number }) => {
    const response = await apiClient.get<ApiSuccess<StockResponse>>(`/ingredients/${ingredientId}/stock`, { params });
    return response.data;
  },
  addStock: async (ingredientId: string, payload: { quantity: number; note?: string }) => {
    const response = await apiClient.post<ApiSuccess<{ stock: IngredientStockDetails }>>(
      `/ingredients/${ingredientId}/stock/add`,
      payload
    );
    return response.data;
  },
  adjustStock: async (ingredientId: string, payload: { quantity: number; note?: string }) => {
    const response = await apiClient.post<ApiSuccess<{ stock: IngredientStockDetails }>>(
      `/ingredients/${ingredientId}/stock/adjust`,
      payload
    );
    return response.data;
  },
  getAllocations: async (params: {
    date: string;
    search?: string;
    categoryId?: string;
    page?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<ApiSuccess<AllocationListResponse>>("/ingredients/allocations", { params });
    return response.data;
  },
  getAllocationStats: async (params: { date: string; search?: string; categoryId?: string }) => {
    const response = await apiClient.get<ApiSuccess<AllocationStatsResponse>>("/ingredients/allocations/stats", {
      params
    });
    return response.data;
  },
  getStockAudit: async (params: { date: string; staffId?: string; page?: number; limit?: number }) => {
    const response = await apiClient.get<ApiSuccess<StockAuditResponse>>("/ingredients/stock-audit", { params });
    return response.data;
  },
  assignAllStockToDate: async (payload: { date: string; note?: string }) => {
    const response = await apiClient.post<
      ApiSuccess<{
        date: string;
        summary: { allocatedCount: number; skippedCount: number; failedCount: number };
      }>
    >("/ingredients/allocations/assign-all", payload);
    return response.data;
  },
  continueYesterdayAllocation: async (payload: { date: string; note?: string }) => {
    const response = await apiClient.post<
      ApiSuccess<{
        date: string;
        previousDate: string;
        summary: { copiedCount: number; partialCount: number; skippedCount: number };
      }>
    >("/ingredients/allocations/continue-yesterday", payload);
    return response.data;
  },
  saveAllocation: async (payload: { ingredientId: string; date: string; allocatedQuantity: number; note?: string }) => {
    const response = await apiClient.post<ApiSuccess<{ allocation: IngredientAllocation }>>(
      "/ingredients/allocations",
      payload
    );
    return response.data;
  },
  updateAllocation: async (
    id: string,
    payload: { allocatedQuantity?: number; usedQuantity?: number; note?: string }
  ) => {
    const response = await apiClient.patch<ApiSuccess<{ allocation: IngredientAllocation }>>(
      `/ingredients/allocations/${id}`,
      payload
    );
    return response.data;
  }
};
