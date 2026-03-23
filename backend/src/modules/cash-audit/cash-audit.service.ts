import { SelectQueryBuilder } from "typeorm";

import { UserRole } from "../../constants/roles";
import { AppDataSource } from "../../database/data-source";
import { AppError } from "../../errors/app-error";
import { comparePassword } from "../../utils/password";
import { User } from "../users/user.entity";
import { CashAudit } from "./cash-audit.entity";
import { CASH_DENOMINATIONS, type CashDenominationCounts } from "./cash-audit.constants";

type CreateCashAuditEntryInput = {
  auditDate?: string;
  denominationCounts: Record<string, number>;
  staffCashTakenAmount?: number;
  note?: string;
  adminPassword?: string;
};

type AdminListFilters = {
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page: number;
  limit: number;
};

type StatsFilters = {
  dateFrom?: string;
  dateTo?: string;
};

type SafeUser = {
  id: string;
  fullName: string;
  username: string;
  role: UserRole;
};

type CashAuditUserContext = {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
};

type CashAuditListItem = {
  id: string;
  auditDate: string;
  denominationCounts: CashDenominationCounts;
  countedAmount: number;
  staffCashTakenAmount: number;
  totalPieces: number;
  differenceFromPrevious: number;
  note: string | null;
  createdByUserId: string;
  createdByUserName: string;
  createdByUsername: string;
  approvedByAdminId: string;
  approvedByAdminName: string;
  approvedByAdminUsername: string;
  createdAt: Date;
  updatedAt: Date;
};

const todayDateString = () => new Date().toISOString().slice(0, 10);
const toFixedAmount = (value: number) => Number(value.toFixed(2));

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeText = (value: string | undefined | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const computeTotalPieces = (counts: CashDenominationCounts) =>
  CASH_DENOMINATIONS.reduce((sum, denomination) => sum + toNumber(counts[String(denomination)]), 0);

export class CashAuditService {
  private readonly cashAuditRepository = AppDataSource.getRepository(CashAudit);
  private readonly userRepository = AppDataSource.getRepository(User);

  private async isCashAuditStorageReady() {
    if (!AppDataSource.isInitialized || !AppDataSource.hasMetadata(CashAudit)) {
      return false;
    }

    const queryRunner = AppDataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      return queryRunner.hasTable("cash_audits");
    } catch {
      return false;
    } finally {
      await queryRunner.release();
    }
  }

  private applyDateFilters(query: SelectQueryBuilder<CashAudit>, filters: StatsFilters) {
    if (filters.dateFrom) {
      query.andWhere("cashAudit.auditDate >= :dateFrom", { dateFrom: filters.dateFrom });
    }
    if (filters.dateTo) {
      query.andWhere("cashAudit.auditDate <= :dateTo", { dateTo: filters.dateTo });
    }
  }

  private normalizeDenominationCounts(input: Record<string, number>): CashDenominationCounts {
    const normalized: CashDenominationCounts = {};
    for (const denomination of CASH_DENOMINATIONS) {
      const key = String(denomination);
      const count = Math.max(0, Math.floor(toNumber(input[key])));
      normalized[key] = count;
    }
    return normalized;
  }

  private calculateCountedAmount(counts: CashDenominationCounts) {
    const total = CASH_DENOMINATIONS.reduce((sum, denomination) => {
      const key = String(denomination);
      return sum + denomination * toNumber(counts[key]);
    }, 0);
    return toFixedAmount(total);
  }

  private async verifyAdminPassword(password: string): Promise<SafeUser> {
    const admins = await this.userRepository
      .createQueryBuilder("user")
      .addSelect("user.passwordHash")
      .where("user.role = :role", { role: UserRole.ADMIN })
      .andWhere("user.isActive = true")
      .getMany();

    for (const admin of admins) {
      if (!admin.passwordHash) {
        continue;
      }
      const valid = await comparePassword(password, admin.passwordHash);
      if (valid) {
        return {
          id: admin.id,
          fullName: admin.fullName,
          username: admin.username,
          role: admin.role
        };
      }
    }

    throw new AppError(401, "Admin password verification failed. Please enter a valid admin password.");
  }

  private async resolveApprover(
    actor: CashAuditUserContext,
    adminPassword: string | undefined
  ): Promise<SafeUser> {
    if (actor.role === UserRole.ADMIN) {
      return {
        id: actor.id,
        fullName: actor.fullName,
        username: actor.username,
        role: actor.role
      };
    }

    if (!adminPassword) {
      throw new AppError(422, "Admin password is required to submit cash audit from staff side.");
    }

    return this.verifyAdminPassword(adminPassword);
  }

  private async buildDifferenceMap(filters: StatsFilters): Promise<Map<string, number>> {
    const query = this.cashAuditRepository
      .createQueryBuilder("cashAudit")
      .select(["cashAudit.id AS id", "cashAudit.countedAmount AS countedAmount"])
      .orderBy("cashAudit.createdAt", "ASC");

    this.applyDateFilters(query, filters);

    const rows = await query.getRawMany<{ id: string; countedAmount: string }>();
    const differences = new Map<string, number>();
    let previous = 0;

    rows.forEach((row, index) => {
      const current = toNumber(row.countedAmount);
      differences.set(row.id, toFixedAmount(index === 0 ? current : current - previous));
      previous = current;
    });

    return differences;
  }

  private mapRecord(record: CashAudit, differenceFromPrevious: number): CashAuditListItem {
    const denominationCounts = this.normalizeDenominationCounts(record.denominationCounts ?? {});
    return {
      id: record.id,
      auditDate: record.auditDate,
      denominationCounts,
      countedAmount: toFixedAmount(toNumber(record.countedAmount)),
      staffCashTakenAmount: toFixedAmount(toNumber(record.staffCashTakenAmount)),
      totalPieces: computeTotalPieces(denominationCounts),
      differenceFromPrevious: toFixedAmount(differenceFromPrevious),
      note: record.note,
      createdByUserId: record.createdByUserId,
      createdByUserName: record.createdByUser?.fullName ?? "-",
      createdByUsername: record.createdByUser?.username ?? "-",
      approvedByAdminId: record.approvedByAdminId,
      approvedByAdminName: record.approvedByAdmin?.fullName ?? "-",
      approvedByAdminUsername: record.approvedByAdmin?.username ?? "-",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  async createEntry(actor: CashAuditUserContext, payload: CreateCashAuditEntryInput) {
    const storageReady = await this.isCashAuditStorageReady();
    if (!storageReady) {
      throw new AppError(
        503,
        "Cash audit storage is not initialized yet. Please restart backend and run database sync/migration."
      );
    }

    const approver = await this.resolveApprover(actor, payload.adminPassword);
    const denominationCounts = this.normalizeDenominationCounts(payload.denominationCounts);
    const countedAmount = this.calculateCountedAmount(denominationCounts);
    const staffCashTakenAmount = toFixedAmount(toNumber(payload.staffCashTakenAmount));

    const entry = this.cashAuditRepository.create({
      auditDate: payload.auditDate ?? todayDateString(),
      denominationCounts,
      countedAmount,
      staffCashTakenAmount,
      note: normalizeText(payload.note),
      createdByUserId: actor.id,
      approvedByAdminId: approver.id
    });

    const saved = await this.cashAuditRepository.save(entry);
    const hydrated = await this.cashAuditRepository.findOne({
      where: { id: saved.id },
      relations: {
        createdByUser: true,
        approvedByAdmin: true
      }
    });

    if (!hydrated) {
      throw new AppError(500, "Cash audit entry was saved but could not be loaded.");
    }

    const previousRecord = await this.cashAuditRepository
      .createQueryBuilder("cashAudit")
      .where("cashAudit.createdAt < :createdAt", { createdAt: hydrated.createdAt })
      .orderBy("cashAudit.createdAt", "DESC")
      .getOne();

    const previousAmount = previousRecord ? toNumber(previousRecord.countedAmount) : 0;
    const differenceFromPrevious = previousRecord
      ? toFixedAmount(toNumber(hydrated.countedAmount) - previousAmount)
      : toFixedAmount(toNumber(hydrated.countedAmount));

    return this.mapRecord(hydrated, differenceFromPrevious);
  }

  async listAdminRecords(filters: AdminListFilters) {
    const storageReady = await this.isCashAuditStorageReady();
    if (!storageReady) {
      return {
        records: [],
        pagination: {
          page: Math.max(1, filters.page || 1),
          limit: Math.min(100, Math.max(1, filters.limit || 10)),
          total: 0,
          totalPages: 1
        }
      };
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 10));
    const offset = (page - 1) * limit;

    const query = this.cashAuditRepository
      .createQueryBuilder("cashAudit")
      .leftJoinAndSelect("cashAudit.createdByUser", "createdByUser")
      .leftJoinAndSelect("cashAudit.approvedByAdmin", "approvedByAdmin")
      .orderBy("cashAudit.createdAt", "DESC");

    this.applyDateFilters(query, filters);

    if (filters.search) {
      query.andWhere(
        `(
          LOWER(createdByUser.fullName) LIKE LOWER(:search)
          OR LOWER(createdByUser.username) LIKE LOWER(:search)
          OR LOWER(approvedByAdmin.fullName) LIKE LOWER(:search)
          OR LOWER(approvedByAdmin.username) LIKE LOWER(:search)
        )`,
        { search: `%${filters.search}%` }
      );
    }

    const [rows, total, differenceMap] = await Promise.all([
      query.clone().offset(offset).limit(limit).getMany(),
      query.getCount(),
      this.buildDifferenceMap(filters)
    ]);

    return {
      records: rows.map((row) => this.mapRecord(row, differenceMap.get(row.id) ?? 0)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    };
  }

  async getAdminStats(filters: StatsFilters) {
    const storageReady = await this.isCashAuditStorageReady();
    if (!storageReady) {
      return {
        totalAudits: 0,
        totalCountedAmount: 0,
        totalStaffCashTaken: 0,
        latestAuditAt: null,
        latestAuditDate: null,
        latestCountedAmount: 0,
        previousCountedAmount: 0,
        differenceFromLastAudit: 0,
        latestTotalPieces: 0,
        averageCountedAmount: 0
      };
    }

    const query = this.cashAuditRepository.createQueryBuilder("cashAudit");
    this.applyDateFilters(query, filters);

    const rows = await query.orderBy("cashAudit.createdAt", "ASC").getMany();

    const totalAudits = rows.length;
    const totalCountedAmount = toFixedAmount(rows.reduce((sum, row) => sum + toNumber(row.countedAmount), 0));
    const totalStaffCashTaken = toFixedAmount(
      rows.reduce((sum, row) => sum + toNumber(row.staffCashTakenAmount), 0)
    );

    const latest = rows.length ? rows[rows.length - 1] : null;
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    const latestCountedAmount = toFixedAmount(toNumber(latest?.countedAmount));
    const previousCountedAmount = toFixedAmount(toNumber(previous?.countedAmount));
    const differenceFromLastAudit = latest
      ? toFixedAmount(latestCountedAmount - previousCountedAmount)
      : 0;

    const latestCounts = latest
      ? this.normalizeDenominationCounts((latest.denominationCounts ?? {}) as Record<string, number>)
      : this.normalizeDenominationCounts({});

    return {
      totalAudits,
      totalCountedAmount,
      totalStaffCashTaken,
      latestAuditAt: latest?.createdAt ?? null,
      latestAuditDate: latest?.auditDate ?? null,
      latestCountedAmount,
      previousCountedAmount,
      differenceFromLastAudit,
      latestTotalPieces: computeTotalPieces(latestCounts),
      averageCountedAmount: totalAudits ? toFixedAmount(totalCountedAmount / totalAudits) : 0
    };
  }

  async getStaffLastAuditInfo() {
    const storageReady = await this.isCashAuditStorageReady();
    if (!storageReady) {
      return {
        hasAudit: false,
        lastAuditAt: null,
        lastAuditDate: null,
        lastAuditedBy: null
      };
    }

    const latest = await this.cashAuditRepository
      .createQueryBuilder("cashAudit")
      .leftJoinAndSelect("cashAudit.createdByUser", "createdByUser")
      .orderBy("cashAudit.createdAt", "DESC")
      .limit(1)
      .getOne();

    if (!latest) {
      return {
        hasAudit: false,
        lastAuditAt: null,
        lastAuditDate: null,
        lastAuditedBy: null
      };
    }

    return {
      hasAudit: true,
      lastAuditAt: latest.createdAt,
      lastAuditDate: latest.auditDate,
      lastAuditedBy: latest.createdByUser?.fullName ?? latest.createdByUser?.username ?? "-"
    };
  }
}
