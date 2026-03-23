import { AppDataSource } from "../../database/data-source";
import { UserRole } from "../../constants/roles";
import { AppError } from "../../errors/app-error";
import { User } from "../users/user.entity";
import {
  ALL_GAMING_RESOURCES,
  CONSOLE_RESOURCES,
  GAMING_BOOKING_STATUSES,
  GAMING_BOOKING_TYPES,
  GAMING_PAYMENT_MODES,
  GAMING_PAYMENT_STATUSES,
  GAMING_RESOURCE_LABELS,
  SNOOKER_RESOURCES,
  type GamingPaymentMode,
  type GamingBookingStatus,
  type GamingBookingType,
  type GamingPaymentStatus
} from "./gaming.constants";
import { GamingBooking } from "./gaming-booking.entity";

type GamingContext = {
  userId: string;
  role: UserRole;
};

type PaginationInput = {
  page: number;
  limit: number;
};

type ListBookingsInput = PaginationInput & {
  search?: string;
  bookingType?: GamingBookingType;
  status?: GamingBookingStatus;
  paymentStatus?: GamingPaymentStatus;
  resourceCode?: string;
  dateFrom?: string;
  dateTo?: string;
};

type BookingCustomerMember = {
  name: string;
  phone: string;
};

type CreateBookingInput = {
  bookingNumber?: string;
  bookingType: GamingBookingType;
  resourceCode: string;
  checkInAt?: string;
  hourlyRate: number;
  customers: BookingCustomerMember[];
  bookingChannel?: string;
  note?: string;
  sourceDeviceId?: string;
  status?: GamingBookingStatus;
  paymentStatus?: GamingPaymentStatus;
  paymentMode?: GamingPaymentMode;
  finalAmount?: number;
  checkOutAt?: string;
  foodOrderReference?: string;
  foodInvoiceNumber?: string;
  foodInvoiceStatus?: "none" | "pending" | "paid" | "cancelled";
  foodAndBeverageAmount?: number;
  staffId?: string;
};

type UpdateBookingInput = {
  bookingType?: GamingBookingType;
  resourceCode?: string;
  checkInAt?: string;
  hourlyRate?: number;
  customers?: BookingCustomerMember[];
  bookingChannel?: string;
  note?: string;
  status?: "upcoming" | "ongoing" | "cancelled";
  paymentStatus?: "pending" | "paid";
  paymentMode?: GamingPaymentMode;
  foodOrderReference?: string;
  foodInvoiceNumber?: string;
  foodInvoiceStatus?: "none" | "pending" | "paid" | "cancelled";
  foodAndBeverageAmount?: number;
};

const normalizePhone = (value: string) => value.replace(/[^\d+]/g, "").trim();
const cleanText = (value?: string | null) => {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundCurrency = (value: number) => Number(value.toFixed(2));

const parseDateOrThrow = (value: string | undefined | null, fieldName: string) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(422, `${fieldName} is invalid.`);
  }
  return parsed;
};

const getMinutesBetween = (start: Date, end: Date) => {
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) {
    return 0;
  }
  return Math.ceil(diffMs / 60000);
};

const isPrivileged = (role: UserRole) =>
  role === UserRole.ADMIN || role === UserRole.MANAGER || role === UserRole.ACCOUNTANT;

const getPaginationMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit))
});

const buildDateRange = (input: { dateFrom?: string; dateTo?: string }) => {
  const from = input.dateFrom ? parseDateOrThrow(`${input.dateFrom}T00:00:00.000Z`, "Date from") : null;
  const to = input.dateTo ? parseDateOrThrow(`${input.dateTo}T23:59:59.999Z`, "Date to") : null;
  if (from && to && from > to) {
    throw new AppError(422, "Date to must be on or after date from.");
  }
  return { from, to };
};

export class GamingService {
  private readonly bookingRepository = AppDataSource.getRepository(GamingBooking);
  private readonly userRepository = AppDataSource.getRepository(User);

  private validateResource(bookingType: GamingBookingType, resourceCode: string) {
    const normalized = resourceCode.trim().toLowerCase();
    if (!ALL_GAMING_RESOURCES.includes(normalized as (typeof ALL_GAMING_RESOURCES)[number])) {
      throw new AppError(422, "Selected board/console is invalid.");
    }
    if (bookingType === "snooker" && !SNOOKER_RESOURCES.includes(normalized as (typeof SNOOKER_RESOURCES)[number])) {
      throw new AppError(422, "Snooker booking must use one of the 6 snooker boards.");
    }
    if (bookingType === "console" && !CONSOLE_RESOURCES.includes(normalized as (typeof CONSOLE_RESOURCES)[number])) {
      throw new AppError(422, "Console booking must use PS2, PS4, PS5 or Xbox.");
    }
    return normalized;
  }

  private sanitizeCustomerGroup(customers: BookingCustomerMember[]) {
    const sanitized = customers
      .map((member) => ({
        name: member.name.trim(),
        phone: normalizePhone(member.phone)
      }))
      .filter((member) => member.name.length > 0 && member.phone.length > 0);

    if (!sanitized.length) {
      throw new AppError(422, "Add at least one customer name and phone for booking.");
    }
    return sanitized;
  }

  private sanitizePayment(input: { paymentStatus?: string; paymentMode?: string }, fallbackStatus: GamingPaymentStatus) {
    const paymentStatus =
      input.paymentStatus && GAMING_PAYMENT_STATUSES.includes(input.paymentStatus as GamingPaymentStatus)
        ? (input.paymentStatus as GamingPaymentStatus)
        : fallbackStatus;
    const paymentMode =
      input.paymentMode && GAMING_PAYMENT_MODES.includes(input.paymentMode as GamingPaymentMode)
        ? (input.paymentMode as GamingPaymentMode)
        : null;

    if (paymentStatus === "paid" && !paymentMode) {
      throw new AppError(422, "Select payment mode when status is paid.");
    }

    return {
      paymentStatus,
      paymentMode: paymentStatus === "paid" ? paymentMode : null
    };
  }

  private calculateAmount(input: { checkInAt: Date; checkOutAt: Date | null; hourlyRate: number; status: GamingBookingStatus }) {
    const now = new Date();
    const effectiveEnd = input.checkOutAt ?? (input.status === "upcoming" ? input.checkInAt : now);
    const minutes = getMinutesBetween(input.checkInAt, effectiveEnd);
    const amount = roundCurrency((minutes / 60) * input.hourlyRate);
    return { minutes, amount };
  }

  private toDto(booking: GamingBooking) {
    const hourlyRate = toNumber(booking.hourlyRate);
    const finalAmountStored = toNumber(booking.finalAmount);
    const computed = this.calculateAmount({
      checkInAt: booking.checkInAt,
      checkOutAt: booking.checkOutAt,
      hourlyRate,
      status: booking.status
    });

    const finalAmount = booking.status === "completed" ? (finalAmountStored > 0 ? finalAmountStored : computed.amount) : computed.amount;
    return {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      bookingType: booking.bookingType,
      resourceCode: booking.resourceCode,
      resourceLabel: booking.resourceLabel,
      customers: booking.customerGroup ?? [],
      customerCount: (booking.customerGroup ?? []).length,
      primaryCustomerName: booking.primaryCustomerName,
      primaryCustomerPhone: booking.primaryCustomerPhone,
      checkInAt: booking.checkInAt,
      checkOutAt: booking.checkOutAt,
      hourlyRate,
      durationMinutes: computed.minutes,
      calculatedAmount: computed.amount,
      finalAmount,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      paymentMode: booking.paymentMode,
      foodOrderReference: booking.foodOrderReference,
      foodInvoiceNumber: booking.foodInvoiceNumber,
      foodInvoiceStatus: booking.foodInvoiceStatus,
      foodAndBeverageAmount: toNumber(booking.foodAndBeverageAmount),
      bookingChannel: booking.bookingChannel,
      sourceDeviceId: booking.sourceDeviceId,
      note: booking.note,
      staffId: booking.staffId,
      staffName: booking.staff?.fullName ?? "-",
      staffUsername: booking.staff?.username ?? "-",
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt
    };
  }

  private buildBookingNumber() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `GM-${y}${m}${d}-${hh}${mm}-${random}`;
  }

  private async assertResourceAvailable(resourceCode: string, excludeBookingId?: string) {
    const query = this.bookingRepository
      .createQueryBuilder("booking")
      .where("booking.resourceCode = :resourceCode", { resourceCode })
      .andWhere("booking.status IN (:...statuses)", { statuses: ["upcoming", "ongoing"] });

    if (excludeBookingId) {
      query.andWhere("booking.id != :excludeBookingId", { excludeBookingId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new AppError(409, `${GAMING_RESOURCE_LABELS[resourceCode] ?? resourceCode} is currently occupied. Choose another slot.`);
    }
  }

  async createBooking(input: CreateBookingInput, context: GamingContext) {
    const bookingType = input.bookingType;
    if (!GAMING_BOOKING_TYPES.includes(bookingType)) {
      throw new AppError(422, "Booking type is invalid.");
    }
    const resourceCode = this.validateResource(bookingType, input.resourceCode);
    const customerGroup = this.sanitizeCustomerGroup(input.customers);
    await this.assertResourceAvailable(resourceCode);

    const checkInAt = parseDateOrThrow(input.checkInAt, "Check-in time") ?? new Date();
    const status =
      input.status && GAMING_BOOKING_STATUSES.includes(input.status)
        ? input.status
        : checkInAt.getTime() > Date.now()
          ? "upcoming"
          : "ongoing";
    const checkOutAt = parseDateOrThrow(input.checkOutAt, "Check-out time");
    const payment = this.sanitizePayment(
      { paymentStatus: input.paymentStatus, paymentMode: input.paymentMode },
      "pending"
    );
    const hourlyRate = roundCurrency(Math.max(0, toNumber(input.hourlyRate)));

    const staffId = input.staffId && isPrivileged(context.role) ? input.staffId : context.userId;
    const staff = await this.userRepository.findOne({ where: { id: staffId, isActive: true } });
    if (!staff) {
      throw new AppError(404, "Staff member not found for this booking.");
    }

    const calculated = this.calculateAmount({
      checkInAt,
      checkOutAt,
      hourlyRate,
      status
    });

    const booking = this.bookingRepository.create({
      bookingNumber: cleanText(input.bookingNumber) ?? this.buildBookingNumber(),
      bookingType,
      resourceCode,
      resourceLabel: GAMING_RESOURCE_LABELS[resourceCode] ?? resourceCode,
      customerGroup,
      primaryCustomerName: customerGroup[0]?.name ?? null,
      primaryCustomerPhone: customerGroup[0]?.phone ?? null,
      checkInAt,
      checkOutAt,
      hourlyRate,
      finalAmount: roundCurrency(
        Math.max(0, toNumber(input.finalAmount, status === "completed" ? calculated.amount : 0))
      ),
      status,
      paymentStatus: payment.paymentStatus,
      paymentMode: payment.paymentMode,
      foodOrderReference: cleanText(input.foodOrderReference),
      foodInvoiceNumber: cleanText(input.foodInvoiceNumber),
      foodInvoiceStatus: input.foodInvoiceStatus ?? "none",
      foodAndBeverageAmount: roundCurrency(Math.max(0, toNumber(input.foodAndBeverageAmount))),
      bookingChannel: cleanText(input.bookingChannel) ?? "desktop",
      sourceDeviceId: cleanText(input.sourceDeviceId),
      note: cleanText(input.note),
      staffId: staff.id
    });

    const saved = await this.bookingRepository.save(booking);
    const withStaff = await this.bookingRepository.findOne({
      where: { id: saved.id },
      relations: { staff: true }
    });
    if (!withStaff) {
      throw new AppError(500, "Unable to fetch booking after creation.");
    }
    return this.toDto(withStaff);
  }

  async updateBooking(id: string, input: UpdateBookingInput, context: GamingContext) {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: { staff: true }
    });
    if (!booking) {
      throw new AppError(404, "Booking not found.");
    }
    if (!isPrivileged(context.role) && booking.staffId !== context.userId) {
      throw new AppError(403, "You can only edit your own bookings.");
    }
    if (booking.status === "completed") {
      throw new AppError(409, "Completed bookings cannot be edited.");
    }

    const nextBookingType = input.bookingType ?? booking.bookingType;
    const nextResourceCode = input.resourceCode
      ? this.validateResource(nextBookingType, input.resourceCode)
      : booking.resourceCode;

    if (nextResourceCode !== booking.resourceCode || nextBookingType !== booking.bookingType) {
      await this.assertResourceAvailable(nextResourceCode, booking.id);
    }

    const nextCheckInAt = parseDateOrThrow(input.checkInAt, "Check-in time") ?? booking.checkInAt;
    const nextStatus = input.status ?? booking.status;

    const payment = this.sanitizePayment(
      {
        paymentStatus: input.paymentStatus ?? booking.paymentStatus,
        paymentMode: input.paymentMode ?? booking.paymentMode ?? undefined
      },
      booking.paymentStatus
    );

    booking.bookingType = nextBookingType;
    booking.resourceCode = nextResourceCode;
    booking.resourceLabel = GAMING_RESOURCE_LABELS[nextResourceCode] ?? nextResourceCode;
    booking.checkInAt = nextCheckInAt;
    booking.status = nextStatus;
    booking.hourlyRate = roundCurrency(Math.max(0, toNumber(input.hourlyRate, toNumber(booking.hourlyRate))));
    booking.bookingChannel = cleanText(input.bookingChannel) ?? booking.bookingChannel;
    booking.note = cleanText(input.note);
    booking.paymentStatus = payment.paymentStatus;
    booking.paymentMode = payment.paymentMode;
    booking.foodOrderReference =
      input.foodOrderReference === undefined ? booking.foodOrderReference : cleanText(input.foodOrderReference);
    booking.foodInvoiceNumber =
      input.foodInvoiceNumber === undefined ? booking.foodInvoiceNumber : cleanText(input.foodInvoiceNumber);
    booking.foodInvoiceStatus = input.foodInvoiceStatus ?? booking.foodInvoiceStatus;
    if (input.foodAndBeverageAmount !== undefined) {
      booking.foodAndBeverageAmount = roundCurrency(Math.max(0, toNumber(input.foodAndBeverageAmount)));
    }

    if (input.customers?.length) {
      const customerGroup = this.sanitizeCustomerGroup(input.customers);
      booking.customerGroup = customerGroup;
      booking.primaryCustomerName = customerGroup[0]?.name ?? null;
      booking.primaryCustomerPhone = customerGroup[0]?.phone ?? null;
    }

    const saved = await this.bookingRepository.save(booking);
    const withStaff = await this.bookingRepository.findOne({
      where: { id: saved.id },
      relations: { staff: true }
    });
    if (!withStaff) {
      throw new AppError(500, "Unable to fetch booking after update.");
    }
    return this.toDto(withStaff);
  }

  async checkoutBooking(
    id: string,
    input: {
      checkOutAt?: string;
      finalAmount?: number;
      paymentStatus?: "pending" | "paid";
      paymentMode?: GamingPaymentMode;
    },
    context: GamingContext
  ) {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: { staff: true }
    });
    if (!booking) {
      throw new AppError(404, "Booking not found.");
    }
    if (!isPrivileged(context.role) && booking.staffId !== context.userId) {
      throw new AppError(403, "You can only checkout your own bookings.");
    }
    if (booking.status === "completed") {
      throw new AppError(409, "Booking is already checked out.");
    }

    const checkOutAt = parseDateOrThrow(input.checkOutAt, "Check-out time") ?? new Date();
    if (checkOutAt < booking.checkInAt) {
      throw new AppError(422, "Check-out time must be after check-in time.");
    }

    const payment = this.sanitizePayment(
      {
        paymentStatus: input.paymentStatus ?? booking.paymentStatus,
        paymentMode: input.paymentMode ?? booking.paymentMode ?? undefined
      },
      booking.paymentStatus
    );

    const hourlyRate = toNumber(booking.hourlyRate);
    const calculated = this.calculateAmount({
      checkInAt: booking.checkInAt,
      checkOutAt,
      hourlyRate,
      status: "completed"
    });

    booking.checkOutAt = checkOutAt;
    booking.status = "completed";
    booking.finalAmount = roundCurrency(Math.max(0, toNumber(input.finalAmount, calculated.amount)));
    booking.paymentStatus = payment.paymentStatus;
    booking.paymentMode = payment.paymentMode;

    const saved = await this.bookingRepository.save(booking);
    const withStaff = await this.bookingRepository.findOne({
      where: { id: saved.id },
      relations: { staff: true }
    });
    if (!withStaff) {
      throw new AppError(500, "Unable to fetch booking after checkout.");
    }
    return this.toDto(withStaff);
  }

  async updatePaymentStatus(
    id: string,
    paymentStatus: "pending" | "paid",
    paymentMode: GamingPaymentMode | undefined,
    context: GamingContext
  ) {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: { staff: true }
    });
    if (!booking) {
      throw new AppError(404, "Booking not found.");
    }
    if (!isPrivileged(context.role) && booking.staffId !== context.userId) {
      throw new AppError(403, "You can only update your own bookings.");
    }
    if (booking.status === "completed") {
      throw new AppError(409, "Payment status cannot be changed after checkout.");
    }

    const payment = this.sanitizePayment(
      { paymentStatus, paymentMode: paymentMode ?? booking.paymentMode ?? undefined },
      booking.paymentStatus
    );
    booking.paymentStatus = payment.paymentStatus;
    booking.paymentMode = payment.paymentMode;
    const saved = await this.bookingRepository.save(booking);
    return this.toDto(saved);
  }

  async listBookings(filters: ListBookingsInput, context: GamingContext) {
    const query = this.bookingRepository
      .createQueryBuilder("booking")
      .leftJoinAndSelect("booking.staff", "staff");

    if (!isPrivileged(context.role)) {
      query.andWhere("booking.staffId = :staffId", { staffId: context.userId });
    }

    if (filters.bookingType) {
      query.andWhere("booking.bookingType = :bookingType", { bookingType: filters.bookingType });
    }
    if (filters.status) {
      query.andWhere("booking.status = :status", { status: filters.status });
    }
    if (filters.paymentStatus) {
      query.andWhere("booking.paymentStatus = :paymentStatus", { paymentStatus: filters.paymentStatus });
    }
    if (filters.resourceCode?.trim()) {
      query.andWhere("booking.resourceCode = :resourceCode", { resourceCode: filters.resourceCode.trim().toLowerCase() });
    }
    if (filters.search?.trim()) {
      const search = `%${filters.search.trim()}%`;
      query.andWhere(
        "(booking.bookingNumber ILIKE :search OR booking.primaryCustomerName ILIKE :search OR booking.primaryCustomerPhone ILIKE :search OR booking.resourceLabel ILIKE :search OR staff.fullName ILIKE :search)",
        { search }
      );
    }

    const dateRange = buildDateRange(filters);
    if (dateRange.from) {
      query.andWhere("booking.checkInAt >= :dateFrom", { dateFrom: dateRange.from });
    }
    if (dateRange.to) {
      query.andWhere("booking.checkInAt <= :dateTo", { dateTo: dateRange.to });
    }

    const total = await query.getCount();
    const bookings = await query
      .clone()
      .orderBy("booking.checkInAt", "DESC")
      .addOrderBy("booking.createdAt", "DESC")
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getMany();

    return {
      bookings: bookings.map((booking) => this.toDto(booking)),
      pagination: getPaginationMeta(filters.page, filters.limit, total)
    };
  }

  async getStats(input: { dateFrom?: string; dateTo?: string }, context: GamingContext) {
    const query = this.bookingRepository
      .createQueryBuilder("booking")
      .leftJoinAndSelect("booking.staff", "staff");

    if (!isPrivileged(context.role)) {
      query.andWhere("booking.staffId = :staffId", { staffId: context.userId });
    }

    const dateRange = buildDateRange(input);
    if (dateRange.from) {
      query.andWhere("booking.checkInAt >= :dateFrom", { dateFrom: dateRange.from });
    }
    if (dateRange.to) {
      query.andWhere("booking.checkInAt <= :dateTo", { dateTo: dateRange.to });
    }

    const bookings = await query.getMany();
    const now = new Date();

    const totals = {
      totalBookings: bookings.length,
      ongoing: 0,
      upcoming: 0,
      completed: 0,
      cancelled: 0,
      pendingPayments: 0,
      paidBookings: 0,
      activePlayers: 0,
      endingSoon: 0,
      totalRevenue: 0,
      pendingCollection: 0
    };

    const staffCollectionMap = new Map<string, { staffId: string; staffName: string; collectedAmount: number; bookings: number }>();
    const resourceUsageMap = new Map<string, { resourceCode: string; resourceLabel: string; bookings: number; revenue: number }>();

    bookings.forEach((booking) => {
      const dto = this.toDto(booking);
      totals[dto.status] += 1;
      if (dto.status === "ongoing") {
        totals.activePlayers += dto.customerCount;
        const elapsedMinutes = getMinutesBetween(new Date(dto.checkInAt), now);
        const estMinutesLeft = Math.max(60 - elapsedMinutes, 0);
        if (estMinutesLeft <= 15) {
          totals.endingSoon += 1;
        }
      }
      if (dto.paymentStatus === "pending") {
        totals.pendingPayments += 1;
        totals.pendingCollection = roundCurrency(totals.pendingCollection + dto.finalAmount);
      }
      if (dto.paymentStatus === "paid") {
        totals.paidBookings += 1;
        totals.totalRevenue = roundCurrency(totals.totalRevenue + dto.finalAmount);
      }

      const staffKey = dto.staffId;
      const staffRow = staffCollectionMap.get(staffKey) ?? {
        staffId: dto.staffId,
        staffName: dto.staffName,
        collectedAmount: 0,
        bookings: 0
      };
      if (dto.paymentStatus === "paid") {
        staffRow.collectedAmount = roundCurrency(staffRow.collectedAmount + dto.finalAmount);
      }
      staffRow.bookings += 1;
      staffCollectionMap.set(staffKey, staffRow);

      const resourceKey = dto.resourceCode;
      const resourceRow = resourceUsageMap.get(resourceKey) ?? {
        resourceCode: dto.resourceCode,
        resourceLabel: dto.resourceLabel,
        bookings: 0,
        revenue: 0
      };
      resourceRow.bookings += 1;
      if (dto.paymentStatus === "paid") {
        resourceRow.revenue = roundCurrency(resourceRow.revenue + dto.finalAmount);
      }
      resourceUsageMap.set(resourceKey, resourceRow);
    });

    return {
      totals,
      staffCollection: [...staffCollectionMap.values()].sort((a, b) => b.collectedAmount - a.collectedAmount),
      resourceUsage: [...resourceUsageMap.values()].sort((a, b) => b.bookings - a.bookings)
    };
  }

  async getResources(context: GamingContext) {
    const resources = ALL_GAMING_RESOURCES.map((resourceCode) => ({
      resourceCode,
      resourceLabel: GAMING_RESOURCE_LABELS[resourceCode] ?? resourceCode,
      bookingType: SNOOKER_RESOURCES.includes(resourceCode as (typeof SNOOKER_RESOURCES)[number]) ? "snooker" : "console"
    }));

    const query = this.bookingRepository
      .createQueryBuilder("booking")
      .leftJoinAndSelect("booking.staff", "staff")
      .where("booking.status IN (:...statuses)", { statuses: ["upcoming", "ongoing"] });

    if (!isPrivileged(context.role)) {
      query.andWhere("booking.staffId = :staffId", { staffId: context.userId });
    }

    const activeBookings = await query.getMany();
    const activeMap = new Map(activeBookings.map((booking) => [booking.resourceCode, this.toDto(booking)]));

    return resources.map((resource) => ({
      ...resource,
      isAvailable: !activeMap.has(resource.resourceCode),
      activeBooking: activeMap.get(resource.resourceCode) ?? null
    }));
  }

  async upsertBookingFromSync(input: CreateBookingInput, context: GamingContext) {
    if (!input.bookingNumber?.trim()) {
      throw new AppError(422, "Booking number is required for sync.");
    }

    const existing = await this.bookingRepository.findOne({
      where: { bookingNumber: input.bookingNumber.trim() },
      relations: { staff: true }
    });

    if (!existing) {
      return this.createBooking(input, context);
    }

    const bookingType = input.bookingType;
    const resourceCode = this.validateResource(bookingType, input.resourceCode);
    const customerGroup = this.sanitizeCustomerGroup(input.customers);
    const checkInAt = parseDateOrThrow(input.checkInAt, "Check-in time") ?? existing.checkInAt;
    const checkOutAt = parseDateOrThrow(input.checkOutAt, "Check-out time");
    const status =
      input.status && GAMING_BOOKING_STATUSES.includes(input.status)
        ? input.status
        : existing.status;
    const payment = this.sanitizePayment(
      {
        paymentStatus: input.paymentStatus ?? existing.paymentStatus,
        paymentMode: input.paymentMode ?? existing.paymentMode ?? undefined
      },
      existing.paymentStatus
    );

    if (
      (resourceCode !== existing.resourceCode || bookingType !== existing.bookingType) &&
      (status === "upcoming" || status === "ongoing")
    ) {
      await this.assertResourceAvailable(resourceCode, existing.id);
    }

    existing.bookingType = bookingType;
    existing.resourceCode = resourceCode;
    existing.resourceLabel = GAMING_RESOURCE_LABELS[resourceCode] ?? resourceCode;
    existing.customerGroup = customerGroup;
    existing.primaryCustomerName = customerGroup[0]?.name ?? null;
    existing.primaryCustomerPhone = customerGroup[0]?.phone ?? null;
    existing.checkInAt = checkInAt;
    existing.checkOutAt = checkOutAt ?? existing.checkOutAt;
    existing.hourlyRate = roundCurrency(Math.max(0, toNumber(input.hourlyRate, toNumber(existing.hourlyRate))));
    existing.status = status;
    existing.paymentStatus = payment.paymentStatus;
    existing.paymentMode = payment.paymentMode;
    existing.foodOrderReference =
      input.foodOrderReference === undefined ? existing.foodOrderReference : cleanText(input.foodOrderReference);
    existing.foodInvoiceNumber =
      input.foodInvoiceNumber === undefined ? existing.foodInvoiceNumber : cleanText(input.foodInvoiceNumber);
    existing.foodInvoiceStatus = input.foodInvoiceStatus ?? existing.foodInvoiceStatus;
    if (input.foodAndBeverageAmount !== undefined) {
      existing.foodAndBeverageAmount = roundCurrency(Math.max(0, Number(input.foodAndBeverageAmount)));
    }
    existing.bookingChannel = cleanText(input.bookingChannel) ?? existing.bookingChannel;
    existing.sourceDeviceId = cleanText(input.sourceDeviceId) ?? existing.sourceDeviceId;
    existing.note = cleanText(input.note);
    if (Number.isFinite(input.finalAmount)) {
      existing.finalAmount = roundCurrency(Math.max(0, Number(input.finalAmount)));
    }

    if (status === "completed" && !existing.checkOutAt) {
      existing.checkOutAt = new Date();
    }

    const saved = await this.bookingRepository.save(existing);
    return this.toDto(saved);
  }
}
