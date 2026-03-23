import { env } from "@/config/env";
import { gamingBookingsRepository } from "@/db/repositories/gaming-bookings.repository";
import { syncQueueRepository } from "@/db/repositories/sync-queue.repository";
import { makeId } from "@/utils/idempotency";
import type {
  GamingBooking,
  GamingBookingListFilter,
  GamingBookingStatus,
  GamingBookingType,
  GamingCustomerMember,
  GamingPaymentMode,
  GamingPaymentStatus,
  GamingResourceCode,
  StaffSession,
  SyncQueueRow
} from "@/types/pos";

const SNOOKER_RESOURCES: Array<{ code: GamingResourceCode; label: string }> = [
  { code: "board_1", label: "Snooker Board 1" },
  { code: "board_2", label: "Snooker Board 2" },
  { code: "board_3", label: "Snooker Board 3" },
  { code: "board_4", label: "Snooker Board 4" },
  { code: "board_5", label: "Snooker Board 5" },
  { code: "board_6", label: "Snooker Board 6" }
];

const CONSOLE_RESOURCES: Array<{ code: GamingResourceCode; label: string }> = [
  { code: "ps2", label: "PlayStation 2" },
  { code: "ps4", label: "PlayStation 4" },
  { code: "ps5", label: "PlayStation 5" },
  { code: "xbox", label: "Xbox" }
];

const ALL_RESOURCES = [...SNOOKER_RESOURCES, ...CONSOLE_RESOURCES];

const normalizePhone = (value: string) => value.replace(/[^\d+]/g, "").trim();
const roundCurrency = (value: number) => Number(value.toFixed(2));
const nowIso = () => new Date().toISOString();

const buildBookingNumber = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `GM-${y}${m}${d}-${hh}${mm}-${random}`;
};

const getResourceLabel = (resourceCode: GamingResourceCode) =>
  ALL_RESOURCES.find((entry) => entry.code === resourceCode)?.label ?? resourceCode;

const computeCalculatedAmount = (booking: Pick<GamingBooking, "checkInAt" | "checkOutAt" | "hourlyRate" | "status">) => {
  const checkInAt = new Date(booking.checkInAt);
  const end =
    booking.checkOutAt !== null
      ? new Date(booking.checkOutAt)
      : booking.status === "upcoming"
        ? checkInAt
        : new Date();
  const diffMs = end.getTime() - checkInAt.getTime();
  if (diffMs <= 0) {
    return 0;
  }
  const minutes = Math.ceil(diffMs / 60000);
  return roundCurrency((minutes / 60) * booking.hourlyRate);
};

const buildSyncEvent = (booking: GamingBooking, idempotencyKey: string) => ({
  eventType: "gaming_booking_upsert" as const,
  idempotencyKey,
  deviceId: env.deviceId,
  payload: {
    bookingNumber: booking.bookingNumber,
    bookingType: booking.bookingType,
    resourceCode: booking.resourceCode,
    checkInAt: booking.checkInAt,
    checkOutAt: booking.checkOutAt ?? undefined,
    hourlyRate: booking.hourlyRate,
    customers: booking.customers,
    bookingChannel: booking.bookingChannel ?? undefined,
    note: booking.note ?? undefined,
    sourceDeviceId: booking.sourceDeviceId ?? undefined,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    paymentMode: booking.paymentMode ?? undefined,
    finalAmount: booking.finalAmount,
    foodOrderReference: booking.foodOrderReference ?? undefined,
    foodInvoiceNumber: booking.foodInvoiceNumber ?? undefined,
    foodInvoiceStatus: booking.foodInvoiceStatus,
    foodAndBeverageAmount: booking.foodAndBeverageAmount,
    staffId: booking.staffId
  }
});

const queueBookingSync = async (booking: GamingBooking) => {
  const eventId = makeId();
  const queueRow: SyncQueueRow = {
    id: makeId(),
    idempotencyKey: eventId,
    eventType: "gaming_booking_upsert",
    payload: buildSyncEvent(booking, eventId),
    status: "pending",
    retryCount: 0,
    lastError: null,
    nextRetryAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await syncQueueRepository.enqueue(queueRow);
};

const sanitizeCustomers = (customers: Array<{ name: string; phone: string }>): GamingCustomerMember[] => {
  const sanitized = customers
    .map((entry) => ({ name: entry.name.trim(), phone: normalizePhone(entry.phone) }))
    .filter((entry) => entry.name.length > 0 && entry.phone.length > 0);

  if (!sanitized.length) {
    throw new Error("Add at least one customer with name and phone.");
  }
  return sanitized;
};

const sanitizePayment = (input: { paymentStatus?: GamingPaymentStatus; paymentMode?: GamingPaymentMode | null }) => {
  const paymentStatus = input.paymentStatus ?? "pending";
  const paymentMode = input.paymentMode ?? null;

  if (paymentStatus === "paid" && !paymentMode) {
    throw new Error("Select payment mode when status is paid.");
  }

  return {
    paymentStatus,
    paymentMode: paymentStatus === "paid" ? paymentMode : null
  };
};

export const gamingBookingsService = {
  getResourcesByType(bookingType: GamingBookingType) {
    return bookingType === "snooker" ? SNOOKER_RESOURCES : CONSOLE_RESOURCES;
  },

  async assertResourceAvailable(resourceCode: GamingResourceCode, excludeLocalBookingId?: string) {
    const occupied = await gamingBookingsRepository.list({ status: "ongoing" }, 600);
    const upcoming = await gamingBookingsRepository.list({ status: "upcoming" }, 600);
    const conflict = [...occupied, ...upcoming].find(
      (booking) =>
        booking.resourceCode === resourceCode &&
        booking.localBookingId !== excludeLocalBookingId &&
        booking.status !== "completed" &&
        booking.status !== "cancelled"
    );
    if (conflict) {
      throw new Error(`${getResourceLabel(resourceCode)} is currently occupied.`);
    }
  },

  async listBookings(filters?: GamingBookingListFilter, limit = 400) {
    return gamingBookingsRepository.list(filters, limit);
  },

  async listActiveBookings() {
    return gamingBookingsRepository.list({ status: "ongoing" }, 200);
  },

  async getResourceAvailability(bookingType?: GamingBookingType) {
    const active = await gamingBookingsRepository.list({ status: "ongoing" }, 200);
    const resources = bookingType ? this.getResourcesByType(bookingType) : ALL_RESOURCES;
    const activeByResource = new Map(active.map((booking) => [booking.resourceCode, booking]));

    return resources.map((resource) => ({
      ...resource,
      isAvailable: !activeByResource.has(resource.code),
      activeBooking: activeByResource.get(resource.code) ?? null
    }));
  },

  async createBooking(
    input: {
      bookingType: GamingBookingType;
      resourceCode: GamingResourceCode;
      customers: Array<{ name: string; phone: string }>;
      checkInAt?: string;
      hourlyRate: number;
      bookingChannel?: string;
      note?: string;
      status?: GamingBookingStatus;
      paymentStatus?: GamingPaymentStatus;
      paymentMode?: GamingPaymentMode;
      foodOrderReference?: string;
      foodInvoiceNumber?: string;
      foodInvoiceStatus?: "none" | "pending" | "paid" | "cancelled";
      foodAndBeverageAmount?: number;
    },
    session: StaffSession
  ) {
    await this.assertResourceAvailable(input.resourceCode);
    const customers = sanitizeCustomers(input.customers);
    const payment = sanitizePayment({ paymentStatus: input.paymentStatus, paymentMode: input.paymentMode });
    const checkInAt = input.checkInAt ? new Date(input.checkInAt).toISOString() : nowIso();
    const status =
      input.status ??
      (new Date(checkInAt).getTime() > Date.now() ? "upcoming" : "ongoing");
    const now = nowIso();

    const booking: GamingBooking = {
      localBookingId: makeId(),
      serverBookingId: null,
      bookingNumber: buildBookingNumber(),
      bookingType: input.bookingType,
      resourceCode: input.resourceCode,
      resourceLabel: getResourceLabel(input.resourceCode),
      customers,
      primaryCustomerName: customers[0].name,
      primaryCustomerPhone: customers[0].phone,
      checkInAt,
      checkOutAt: null,
      hourlyRate: roundCurrency(Math.max(0, Number(input.hourlyRate) || 0)),
      finalAmount: 0,
      status,
      paymentStatus: payment.paymentStatus,
      paymentMode: payment.paymentMode,
      foodOrderReference: input.foodOrderReference?.trim() || null,
      foodInvoiceNumber: input.foodInvoiceNumber?.trim() || null,
      foodInvoiceStatus: input.foodInvoiceStatus ?? "none",
      foodAndBeverageAmount: roundCurrency(Math.max(0, Number(input.foodAndBeverageAmount ?? 0))),
      note: input.note?.trim() || null,
      bookingChannel: input.bookingChannel?.trim() || "desktop",
      sourceDeviceId: env.deviceId,
      staffId: session.userId,
      staffName: session.fullName,
      createdAt: now,
      updatedAt: now,
      syncStatus: "pending"
    };

    await gamingBookingsRepository.save(booking);
    await queueBookingSync(booking);
    return booking;
  },

  async checkoutBooking(
    localBookingId: string,
    input: {
      checkOutAt?: string;
      finalAmount?: number;
      paymentStatus?: "pending" | "paid";
      paymentMode?: GamingPaymentMode;
    }
  ) {
    const booking = await gamingBookingsRepository.getById(localBookingId);
    if (!booking) {
      throw new Error("Booking not found.");
    }
    if (booking.status === "completed") {
      throw new Error("This booking is already checked out.");
    }

    const checkOutAt = input.checkOutAt ? new Date(input.checkOutAt).toISOString() : nowIso();
    const computed = computeCalculatedAmount({
      checkInAt: booking.checkInAt,
      checkOutAt,
      hourlyRate: booking.hourlyRate,
      status: "completed"
    });
    const payment = sanitizePayment({
      paymentStatus: input.paymentStatus ?? booking.paymentStatus,
      paymentMode: input.paymentMode ?? booking.paymentMode
    });

    const nextBooking: GamingBooking = {
      ...booking,
      checkOutAt,
      status: "completed",
      paymentStatus: payment.paymentStatus,
      paymentMode: payment.paymentMode,
      finalAmount: roundCurrency(
        Math.max(0, Number.isFinite(input.finalAmount) ? Number(input.finalAmount) : computed)
      ),
      foodOrderReference: booking.foodOrderReference,
      foodInvoiceNumber: booking.foodInvoiceNumber,
      foodInvoiceStatus: booking.foodInvoiceStatus,
      foodAndBeverageAmount: booking.foodAndBeverageAmount,
      updatedAt: nowIso(),
      syncStatus: "pending"
    };

    await gamingBookingsRepository.save(nextBooking);
    await queueBookingSync(nextBooking);
    return nextBooking;
  },

  async updateBooking(
    localBookingId: string,
    input: {
      bookingType?: GamingBookingType;
      resourceCode?: GamingResourceCode;
      customers?: Array<{ name: string; phone: string }>;
      checkInAt?: string;
      hourlyRate?: number;
      status?: "upcoming" | "ongoing" | "cancelled";
      note?: string;
      paymentStatus?: "pending" | "paid";
      paymentMode?: GamingPaymentMode;
    }
  ) {
    const booking = await gamingBookingsRepository.getById(localBookingId);
    if (!booking) {
      throw new Error("Booking not found.");
    }
    if (booking.status === "completed") {
      throw new Error("Completed bookings cannot be edited.");
    }

    const nextBookingType = input.bookingType ?? booking.bookingType;
    const nextResourceCode = input.resourceCode ?? booking.resourceCode;
    if (nextResourceCode !== booking.resourceCode || nextBookingType !== booking.bookingType) {
      await this.assertResourceAvailable(nextResourceCode, booking.localBookingId);
    }

    const payment = sanitizePayment({
      paymentStatus: input.paymentStatus ?? booking.paymentStatus,
      paymentMode: input.paymentMode ?? booking.paymentMode
    });

    const nextBooking: GamingBooking = {
      ...booking,
      bookingType: nextBookingType,
      resourceCode: nextResourceCode,
      resourceLabel: getResourceLabel(nextResourceCode),
      customers: input.customers?.length ? sanitizeCustomers(input.customers) : booking.customers,
      checkInAt: input.checkInAt ? new Date(input.checkInAt).toISOString() : booking.checkInAt,
      hourlyRate: roundCurrency(Math.max(0, Number(input.hourlyRate ?? booking.hourlyRate) || 0)),
      status: input.status ?? booking.status,
      note: input.note === undefined ? booking.note : input.note.trim() || null,
      paymentStatus: payment.paymentStatus,
      paymentMode: payment.paymentMode,
      foodOrderReference: booking.foodOrderReference,
      foodInvoiceNumber: booking.foodInvoiceNumber,
      foodInvoiceStatus: booking.foodInvoiceStatus,
      foodAndBeverageAmount: booking.foodAndBeverageAmount,
      updatedAt: nowIso(),
      syncStatus: "pending"
    };
    nextBooking.primaryCustomerName = nextBooking.customers[0]?.name ?? booking.primaryCustomerName;
    nextBooking.primaryCustomerPhone = nextBooking.customers[0]?.phone ?? booking.primaryCustomerPhone;

    await gamingBookingsRepository.save(nextBooking);
    await queueBookingSync(nextBooking);
    return nextBooking;
  },

  async updatePaymentStatus(localBookingId: string, paymentStatus: GamingPaymentStatus, paymentMode?: GamingPaymentMode) {
    const booking = await gamingBookingsRepository.getById(localBookingId);
    if (!booking) {
      throw new Error("Booking not found.");
    }
    if (booking.status === "completed") {
      throw new Error("Payment status cannot be changed after checkout.");
    }
    const payment = sanitizePayment({ paymentStatus, paymentMode: paymentMode ?? booking.paymentMode });

    const nextBooking: GamingBooking = {
      ...booking,
      paymentStatus: payment.paymentStatus,
      paymentMode: payment.paymentMode,
      foodOrderReference: booking.foodOrderReference,
      foodInvoiceNumber: booking.foodInvoiceNumber,
      foodInvoiceStatus: booking.foodInvoiceStatus,
      foodAndBeverageAmount: booking.foodAndBeverageAmount,
      updatedAt: nowIso(),
      syncStatus: "pending"
    };
    await gamingBookingsRepository.save(nextBooking);
    await queueBookingSync(nextBooking);
    return nextBooking;
  },

  async updateFoodOrderLink(
    localBookingId: string,
    input: {
      foodOrderReference?: string | null;
      foodInvoiceNumber?: string | null;
      foodInvoiceStatus?: "none" | "pending" | "paid" | "cancelled";
      foodAndBeverageAmount?: number;
    }
  ) {
    const booking = await gamingBookingsRepository.getById(localBookingId);
    if (!booking) {
      throw new Error("Booking not found.");
    }
    if (booking.status === "completed") {
      throw new Error("Completed booking cannot be modified.");
    }

    const nextBooking: GamingBooking = {
      ...booking,
      foodOrderReference:
        input.foodOrderReference === undefined ? booking.foodOrderReference : input.foodOrderReference,
      foodInvoiceNumber:
        input.foodInvoiceNumber === undefined ? booking.foodInvoiceNumber : input.foodInvoiceNumber,
      foodInvoiceStatus:
        input.foodInvoiceStatus === undefined ? booking.foodInvoiceStatus : input.foodInvoiceStatus,
      foodAndBeverageAmount:
        input.foodAndBeverageAmount === undefined
          ? booking.foodAndBeverageAmount
          : roundCurrency(Math.max(0, Number(input.foodAndBeverageAmount ?? 0))),
      updatedAt: nowIso(),
      syncStatus: "pending"
    };

    await gamingBookingsRepository.save(nextBooking);
    await queueBookingSync(nextBooking);
    return nextBooking;
  },

  getLiveAmount(booking: GamingBooking) {
    if (booking.status === "completed") {
      return booking.finalAmount;
    }
    return computeCalculatedAmount(booking);
  },

  async getDashboardSnapshot() {
    const all = await gamingBookingsRepository.list(undefined, 500);
    const now = Date.now();

    const ongoing = all.filter((booking) => booking.status === "ongoing");
    const upcoming = all.filter((booking) => booking.status === "upcoming");
    const completed = all.filter((booking) => booking.status === "completed");
    const pendingPayments = all.filter((booking) => booking.paymentStatus === "pending");

    const endingSoon = ongoing.filter((booking) => {
      const elapsedMinutes = Math.ceil((now - new Date(booking.checkInAt).getTime()) / 60000);
      return elapsedMinutes >= 45;
    });

    return {
      ongoingCount: ongoing.length,
      upcomingCount: upcoming.length,
      completedCount: completed.length,
      pendingPaymentsCount: pendingPayments.length,
      activePlayers: ongoing.reduce((sum, booking) => sum + booking.customers.length, 0),
      endingSoonCount: endingSoon.length,
      upcomingBookings: upcoming
        .sort((a, b) => a.checkInAt.localeCompare(b.checkInAt))
        .slice(0, 8),
      ongoingBookings: ongoing
        .sort((a, b) => a.checkInAt.localeCompare(b.checkInAt))
        .slice(0, 8)
    };
  }
};
