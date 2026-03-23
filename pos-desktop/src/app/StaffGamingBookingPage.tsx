import {
  Badge,
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
  useDisclosure,
  useToast
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiEdit2, FiPlus, FiShoppingBag } from "react-icons/fi";

import { usePosAuth } from "@/app/PosAuthContext";
import { usePos } from "@/app/PosContext";
import { customersService } from "@/services/customers.service";
import { gamingBookingsService } from "@/services/gaming-bookings.service";
import { snookerOrderService } from "@/services/snooker-order.service";
import type { CatalogSnapshot, GamingBooking, GamingBookingStatus, GamingBookingType, GamingPaymentMode } from "@/types/pos";
import { formatINR } from "@/utils/currency";

type CustomerDraft = { name: string; phone: string };
type FormMode = "create" | "edit";
type FoodLineType = "item" | "combo" | "product";
type FoodDraftLine = { id: string; lineType: FoodLineType; refId: string; quantity: string };

type BookingForm = {
  bookingType: GamingBookingType;
  resourceCode: string;
  checkInLocal: string;
  hourlyRate: string;
  bookingStatus: "upcoming" | "ongoing" | "cancelled";
  paymentStatus: "pending" | "paid";
  paymentMode: GamingPaymentMode;
  note: string;
  customers: CustomerDraft[];
};

const getNowLocalDateTime = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
};

const toIsoFromLocal = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const isoToLocalInput = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return getNowLocalDateTime();
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
};

const defaultForm = (): BookingForm => ({
  bookingType: "snooker",
  resourceCode: "",
  checkInLocal: getNowLocalDateTime(),
  hourlyRate: "0",
  bookingStatus: "ongoing",
  paymentStatus: "pending",
  paymentMode: "cash",
  note: "",
  customers: [{ name: "", phone: "" }]
});

const createFoodLine = (): FoodDraftLine => ({
  id: Math.random().toString(36).slice(2, 10),
  lineType: "item",
  refId: "",
  quantity: "1"
});

const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN") : "-");
const statusBadgeColor = (status: GamingBookingStatus) => status === "ongoing" ? "green" : status === "upcoming" ? "blue" : status === "completed" ? "purple" : "gray";
const foodStatusColor = (status: GamingBooking["foodInvoiceStatus"]) => status === "paid" ? "green" : status === "pending" ? "orange" : status === "cancelled" ? "red" : "gray";

const calcCheckoutAmount = (booking: GamingBooking, checkOutAtIso: string) => {
  const checkIn = new Date(booking.checkInAt).getTime();
  const checkOut = new Date(checkOutAtIso).getTime();
  if (checkOut <= checkIn) return 0;
  const minutes = Math.ceil((checkOut - checkIn) / 60000);
  return Number(((minutes / 60) * booking.hourlyRate).toFixed(2));
};

const getFoodOptionsByType = (snapshot: CatalogSnapshot | null, lineType: FoodLineType) => {
  if (!snapshot) return [] as Array<{ id: string; label: string; unitPrice: number; gstPercentage: number }>;
  if (lineType === "item") {
    return snapshot.items.filter((x) => x.isActive).map((x) => ({ id: x.id, label: x.name, unitPrice: x.sellingPrice, gstPercentage: x.gstPercentage }));
  }
  if (lineType === "combo") {
    return snapshot.combos.filter((x) => x.isActive).map((x) => ({ id: x.id, label: x.name, unitPrice: x.sellingPrice, gstPercentage: x.gstPercentage }));
  }
  return (snapshot.products ?? []).filter((x) => x.isActive).map((x) => ({ id: x.id, label: x.name, unitPrice: x.sellingPrice, gstPercentage: 0 }));
};

export const StaffGamingBookingPage = () => {
  const toast = useToast();
  const { session } = usePosAuth();
  const { catalog, refreshPendingBills, refreshRecentBills, refreshCompletedBills, refreshKitchenOrders } = usePos();

  const bookingModal = useDisclosure();
  const checkoutModal = useDisclosure();
  const foodModal = useDisclosure();

  const [bookings, setBookings] = useState<GamingBooking[]>([]);
  const [statusFilter, setStatusFilter] = useState<GamingBookingStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingBooking, setEditingBooking] = useState<GamingBooking | null>(null);
  const [form, setForm] = useState<BookingForm>(defaultForm());

  const [checkoutBooking, setCheckoutBooking] = useState<GamingBooking | null>(null);
  const [checkoutAtLocal, setCheckoutAtLocal] = useState(getNowLocalDateTime());
  const [checkoutFinalAmount, setCheckoutFinalAmount] = useState("0");
  const [checkoutPaymentStatus, setCheckoutPaymentStatus] = useState<"pending" | "paid">("pending");
  const [checkoutPaymentMode, setCheckoutPaymentMode] = useState<GamingPaymentMode>("cash");

  const [foodBooking, setFoodBooking] = useState<GamingBooking | null>(null);
  const [foodLines, setFoodLines] = useState<FoodDraftLine[]>([createFoodLine()]);
  const [foodSearch, setFoodSearch] = useState("");

  const loadBookings = useCallback(async () => {
    const rows = await gamingBookingsService.listBookings({ status: statusFilter, search }, 500);
    setBookings(rows);
  }, [search, statusFilter]);

  useEffect(() => { void loadBookings(); }, [loadBookings]);

  const refreshAllViews = useCallback(async () => {
    await Promise.all([loadBookings(), refreshPendingBills(), refreshRecentBills(), refreshCompletedBills(), refreshKitchenOrders()]);
  }, [loadBookings, refreshCompletedBills, refreshKitchenOrders, refreshPendingBills, refreshRecentBills]);

  const resourceOptions = useMemo(() => gamingBookingsService.getResourcesByType(form.bookingType), [form.bookingType]);

  useEffect(() => {
    if (!resourceOptions.length) return;
    setForm((prev) => ({ ...prev, resourceCode: prev.resourceCode || resourceOptions[0].code }));
  }, [resourceOptions]);

  const summary = useMemo(() => {
    const ongoing = bookings.filter((row) => row.status === "ongoing");
    return {
      ongoing: ongoing.length,
      upcoming: bookings.filter((row) => row.status === "upcoming").length,
      completed: bookings.filter((row) => row.status === "completed").length,
      pending: bookings.filter((row) => row.paymentStatus === "pending").length,
      players: ongoing.reduce((sum, row) => sum + row.customers.length, 0)
    };
  }, [bookings]);

  const applyCustomerLookup = async (index: number) => {
    const row = form.customers[index];
    if (!row?.phone.trim() || row.name.trim()) return;
    const found = await customersService.findByPhone(row.phone.trim());
    if (!found) return;
    setForm((prev) => ({ ...prev, customers: prev.customers.map((entry, i) => (i === index ? { name: found.name, phone: found.phone } : entry)) }));
  };

  const openCreate = () => { setFormMode("create"); setEditingBooking(null); setForm(defaultForm()); bookingModal.onOpen(); };

  const openEdit = (booking: GamingBooking) => {
    if (booking.status === "completed") return;
    setFormMode("edit");
    setEditingBooking(booking);
    setForm({
      bookingType: booking.bookingType,
      resourceCode: booking.resourceCode,
      checkInLocal: isoToLocalInput(booking.checkInAt),
      hourlyRate: String(booking.hourlyRate),
      bookingStatus: booking.status,
      paymentStatus: booking.paymentStatus === "paid" ? "paid" : "pending",
      paymentMode: booking.paymentMode ?? "cash",
      note: booking.note ?? "",
      customers: booking.customers.length ? booking.customers.map((entry) => ({ ...entry })) : [{ name: "", phone: "" }]
    });
    bookingModal.onOpen();
  };

  const saveBooking = async () => {
    if (!session || !form.resourceCode) return;
    setSaving(true);
    try {
      if (formMode === "create") {
        await gamingBookingsService.createBooking({
          bookingType: form.bookingType,
          resourceCode: form.resourceCode as GamingBooking["resourceCode"],
          customers: form.customers,
          checkInAt: toIsoFromLocal(form.checkInLocal),
          hourlyRate: Number(form.hourlyRate) || 0,
          status: form.bookingStatus,
          paymentStatus: form.paymentStatus,
          paymentMode: form.paymentStatus === "paid" ? form.paymentMode : undefined,
          note: form.note,
          bookingChannel: "desktop"
        }, session);
      } else if (editingBooking) {
        await gamingBookingsService.updateBooking(editingBooking.localBookingId, {
          bookingType: form.bookingType,
          resourceCode: form.resourceCode as GamingBooking["resourceCode"],
          customers: form.customers,
          checkInAt: toIsoFromLocal(form.checkInLocal),
          hourlyRate: Number(form.hourlyRate) || 0,
          status: form.bookingStatus,
          paymentStatus: form.paymentStatus,
          paymentMode: form.paymentStatus === "paid" ? form.paymentMode : undefined,
          note: form.note
        });
      }
      bookingModal.onClose();
      await loadBookings();
      toast({ status: "success", title: formMode === "create" ? "Booking created" : "Booking updated" });
    } catch (error) {
      toast({ status: "error", title: formMode === "create" ? "Unable to create booking" : "Unable to update booking", description: error instanceof Error ? error.message : "Please retry." });
    } finally { setSaving(false); }
  };
  const openCheckout = (booking: GamingBooking) => {
    if (booking.status === "completed") return;
    const nowLocal = getNowLocalDateTime();
    const systemAmount = calcCheckoutAmount(booking, toIsoFromLocal(nowLocal));
    const foodAmount = booking.foodAndBeverageAmount || 0;
    setCheckoutBooking(booking);
    setCheckoutAtLocal(nowLocal);
    setCheckoutFinalAmount(String(Number((systemAmount + foodAmount).toFixed(2))));
    setCheckoutPaymentStatus(booking.paymentStatus === "paid" ? "paid" : "pending");
    setCheckoutPaymentMode(booking.paymentMode ?? "cash");
    checkoutModal.onOpen();
  };

  const checkoutSystemAmount = useMemo(() => (checkoutBooking ? calcCheckoutAmount(checkoutBooking, toIsoFromLocal(checkoutAtLocal)) : 0), [checkoutAtLocal, checkoutBooking]);
  const checkoutFoodAmount = useMemo(() => checkoutBooking?.foodAndBeverageAmount ?? 0, [checkoutBooking]);

  const confirmCheckout = async () => {
    if (!checkoutBooking) return;
    if (!window.confirm(`Confirm checkout and mark ${checkoutPaymentStatus.toUpperCase()}?`)) return;
    setSaving(true);
    try {
      let latestFoodAmount = checkoutFoodAmount;
      if (checkoutPaymentStatus === "paid" && catalog) {
        const paidFoodOrder = await snookerOrderService.markFoodOrderPaidForCheckout({ booking: checkoutBooking, snapshot: catalog, paymentMode: checkoutPaymentMode });
        if (paidFoodOrder) latestFoodAmount = paidFoodOrder.totals.totalAmount;
      }

      const grandTotal = Number(checkoutFinalAmount) || Number((checkoutSystemAmount + latestFoodAmount).toFixed(2));
      await gamingBookingsService.checkoutBooking(checkoutBooking.localBookingId, {
        checkOutAt: toIsoFromLocal(checkoutAtLocal),
        finalAmount: grandTotal,
        paymentStatus: checkoutPaymentStatus,
        paymentMode: checkoutPaymentStatus === "paid" ? checkoutPaymentMode : undefined
      });

      checkoutModal.onClose();
      await refreshAllViews();
      toast({ status: "success", title: "Checkout completed", description: "Booking is now locked." });
    } catch (error) {
      toast({ status: "error", title: "Checkout failed", description: error instanceof Error ? error.message : "Please retry." });
    } finally { setSaving(false); }
  };

  const openFoodOrderModal = (booking: GamingBooking) => {
    setFoodBooking(booking);
    setFoodSearch("");
    setFoodLines([createFoodLine()]);
    foodModal.onOpen();
  };

  const updateFoodLine = (lineId: string, next: Partial<FoodDraftLine>) => {
    setFoodLines((previous) => previous.map((line) => (line.id === lineId ? { ...line, ...next } : line)));
  };

  const removeFoodLine = (lineId: string) => {
    setFoodLines((previous) => (previous.length <= 1 ? previous : previous.filter((line) => line.id !== lineId)));
  };

  const foodDraftTotal = useMemo(() => {
    return foodLines.reduce((sum, line) => {
      const quantity = Number(line.quantity) || 0;
      const option = getFoodOptionsByType(catalog, line.lineType).find((entry) => entry.id === line.refId);
      if (!option || quantity <= 0) return sum;
      return sum + option.unitPrice * quantity;
    }, 0);
  }, [catalog, foodLines]);

  const getFilteredOptions = (lineType: FoodLineType) => {
    const query = foodSearch.trim().toLowerCase();
    const options = getFoodOptionsByType(catalog, lineType);
    if (!query) return options;
    return options.filter((entry) => entry.label.toLowerCase().includes(query));
  };

  const saveFoodOrder = async () => {
    if (!foodBooking || !catalog) return;
    const payloadLines = foodLines.map((line) => {
      const option = getFoodOptionsByType(catalog, line.lineType).find((entry) => entry.id === line.refId);
      const quantity = Number(line.quantity);
      if (!option || !Number.isFinite(quantity) || quantity <= 0) return null;
      return { lineType: line.lineType, refId: option.id, name: option.label, quantity, unitPrice: option.unitPrice, gstPercentage: option.gstPercentage };
    }).filter((line): line is NonNullable<typeof line> => Boolean(line));

    if (!payloadLines.length || payloadLines.length !== foodLines.length) {
      toast({ status: "warning", title: "Please select valid food/product lines" });
      return;
    }

    setSaving(true);
    try {
      await snookerOrderService.upsertFoodOrder({ booking: foodBooking, snapshot: catalog, lines: payloadLines, notes: `Snooker booking ${foodBooking.bookingNumber}` });
      foodModal.onClose();
      await refreshAllViews();
      toast({ status: "success", title: "Sent to Dip & Dash pending orders" });
    } catch (error) {
      toast({ status: "error", title: "Unable to send order", description: error instanceof Error ? error.message : "Please retry." });
    } finally { setSaving(false); }
  };

  return (
    <VStack align="stretch" spacing={4}>
      <SimpleGrid columns={{ base: 2, xl: 6 }} spacing={3}>
        <Box p={4} border="1px solid rgba(132,79,52,0.2)" borderRadius="14px" bg="white"><Text fontSize="sm">Playing</Text><Text fontSize="2xl" fontWeight={900}>{summary.ongoing}</Text></Box>
        <Box p={4} border="1px solid rgba(132,79,52,0.2)" borderRadius="14px" bg="white"><Text fontSize="sm">Upcoming</Text><Text fontSize="2xl" fontWeight={900}>{summary.upcoming}</Text></Box>
        <Box p={4} border="1px solid rgba(132,79,52,0.2)" borderRadius="14px" bg="white"><Text fontSize="sm">Completed</Text><Text fontSize="2xl" fontWeight={900}>{summary.completed}</Text></Box>
        <Box p={4} border="1px solid rgba(132,79,52,0.2)" borderRadius="14px" bg="white"><Text fontSize="sm">Pending Payment</Text><Text fontSize="2xl" fontWeight={900}>{summary.pending}</Text></Box>
        <Box p={4} border="1px solid rgba(132,79,52,0.2)" borderRadius="14px" bg="white"><Text fontSize="sm">Active Players</Text><Text fontSize="2xl" fontWeight={900}>{summary.players}</Text></Box>
        <Box display="flex" alignItems="end" justifyContent="end"><Button leftIcon={<FiPlus size={16} />} onClick={openCreate}>New Booking</Button></Box>
      </SimpleGrid>

      <Box p={4} border="1px solid rgba(132,79,52,0.2)" borderRadius="14px" bg="white">
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3} mb={3}>
          <FormControl><FormLabel>Status</FormLabel><Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as GamingBookingStatus | "all")}><option value="all">All</option><option value="ongoing">Ongoing</option><option value="upcoming">Upcoming</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></Select></FormControl>
          <FormControl><FormLabel>Search</FormLabel><Input placeholder="Booking/customer/phone" value={search} onChange={(e) => setSearch(e.target.value)} /></FormControl>
          <Box display="flex" alignItems="end"><Button variant="outline" onClick={() => void refreshAllViews()}>Refresh</Button></Box>
        </SimpleGrid>

        <Box border="1px solid rgba(132,79,52,0.16)" borderRadius="12px" overflow="hidden">
          <Table size="sm">
            <Thead bg="#FFF8EE"><Tr><Th>Booking</Th><Th>Customer</Th><Th>Slot</Th><Th>Check In</Th><Th>Amount</Th><Th>Food Order</Th><Th>Status</Th><Th>Payment</Th><Th>Actions</Th></Tr></Thead>
            <Tbody>
              {bookings.map((booking) => (
                <Tr key={booking.localBookingId}>
                  <Td fontWeight={800}>{booking.bookingNumber}</Td>
                  <Td><Text fontWeight={700}>{booking.primaryCustomerName}</Text><Text fontSize="xs" color="#705A50">{booking.primaryCustomerPhone}</Text></Td>
                  <Td><Text textTransform="capitalize">{booking.bookingType}</Text><Text fontSize="xs" color="#705A50">{booking.resourceLabel}</Text></Td>
                  <Td><Text>{formatDateTime(booking.checkInAt)}</Text>{booking.checkOutAt ? <Text fontSize="xs" color="#705A50">Out: {formatDateTime(booking.checkOutAt)}</Text> : null}</Td>
                  <Td fontWeight={800}>{formatINR(gamingBookingsService.getLiveAmount(booking))}</Td>
                  <Td><VStack align="start" spacing={1}><Badge colorScheme={foodStatusColor(booking.foodInvoiceStatus)} textTransform="capitalize">{booking.foodInvoiceStatus === "none" ? "No Order" : booking.foodInvoiceStatus}</Badge><Text fontSize="xs" color="#705A50">{formatINR(booking.foodAndBeverageAmount)}</Text>{booking.foodInvoiceNumber ? <Text fontSize="xs" color="#705A50">{booking.foodInvoiceNumber}</Text> : null}</VStack></Td>
                  <Td><Badge colorScheme={statusBadgeColor(booking.status)} textTransform="capitalize">{booking.status}</Badge></Td>
                  <Td><Badge colorScheme={booking.paymentStatus === "paid" ? "green" : "orange"} textTransform="capitalize">{booking.paymentStatus}</Badge>{booking.paymentStatus === "paid" && booking.paymentMode ? <Text fontSize="xs" textTransform="uppercase">{booking.paymentMode}</Text> : null}</Td>
                  <Td>{booking.status === "completed" ? <Text fontSize="xs" fontWeight={700} color="#705A50">Locked</Text> : <HStack><Button size="xs" variant="outline" leftIcon={<FiEdit2 size={12} />} onClick={() => openEdit(booking)}>Edit</Button><Button size="xs" variant="outline" leftIcon={<FiShoppingBag size={12} />} onClick={() => openFoodOrderModal(booking)}>F&B Order</Button><Button size="xs" onClick={() => openCheckout(booking)}>Checkout</Button></HStack>}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      </Box>

      <Modal isOpen={bookingModal.isOpen} onClose={bookingModal.onClose} size="3xl" closeOnOverlayClick={false}>
        <ModalOverlay /><ModalContent><ModalHeader>{formMode === "create" ? "Create New Booking" : "Edit Booking"}</ModalHeader><ModalCloseButton />
          <ModalBody>
            <VStack align="stretch" spacing={3}>
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                <FormControl><FormLabel>Booking Type</FormLabel><Select value={form.bookingType} onChange={(e) => setForm((p) => ({ ...p, bookingType: e.target.value as GamingBookingType, resourceCode: "" }))}><option value="snooker">Snooker</option><option value="console">Console</option></Select></FormControl>
                <FormControl><FormLabel>Board / Console</FormLabel><Select value={form.resourceCode} onChange={(e) => setForm((p) => ({ ...p, resourceCode: e.target.value }))}>{resourceOptions.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}</Select></FormControl>
              </SimpleGrid>
              <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
                <FormControl><FormLabel>Check In</FormLabel><Input type="datetime-local" value={form.checkInLocal} onChange={(e) => setForm((p) => ({ ...p, checkInLocal: e.target.value }))} /></FormControl>
                <FormControl><FormLabel>Rate / Hour</FormLabel><Input type="number" min={0} value={form.hourlyRate} onChange={(e) => setForm((p) => ({ ...p, hourlyRate: e.target.value }))} /></FormControl>
                <FormControl><FormLabel>Status</FormLabel><Select value={form.bookingStatus} onChange={(e) => setForm((p) => ({ ...p, bookingStatus: e.target.value as BookingForm["bookingStatus"] }))}><option value="ongoing">Ongoing</option><option value="upcoming">Upcoming</option>{formMode === "edit" ? <option value="cancelled">Cancelled</option> : null}</Select></FormControl>
              </SimpleGrid>
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}><FormControl><FormLabel>Payment Status</FormLabel><Select value={form.paymentStatus} onChange={(e) => setForm((p) => ({ ...p, paymentStatus: e.target.value as "pending" | "paid" }))}><option value="pending">Pending</option><option value="paid">Paid</option></Select></FormControl><FormControl isDisabled={form.paymentStatus !== "paid"}><FormLabel>Payment Mode</FormLabel><Select value={form.paymentMode} onChange={(e) => setForm((p) => ({ ...p, paymentMode: e.target.value as GamingPaymentMode }))}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></Select></FormControl></SimpleGrid>
              <Box border="1px solid rgba(132,79,52,0.16)" borderRadius="12px" p={3}><HStack justify="space-between" mb={2}><Text fontWeight={800}>Customers</Text><Button size="sm" variant="outline" leftIcon={<FiPlus size={14} />} onClick={() => setForm((p) => ({ ...p, customers: [...p.customers, { name: "", phone: "" }] }))}>Add Customer</Button></HStack><VStack align="stretch" spacing={2}>{form.customers.map((customer, index) => <HStack key={`customer-${index}`} align="end"><FormControl><FormLabel fontSize="xs">Name</FormLabel><Input value={customer.name} onChange={(e) => setForm((p) => ({ ...p, customers: p.customers.map((entry, i) => i === index ? { ...entry, name: e.target.value } : entry) }))} /></FormControl><FormControl><FormLabel fontSize="xs">Phone</FormLabel><Input value={customer.phone} onBlur={() => void applyCustomerLookup(index)} onChange={(e) => setForm((p) => ({ ...p, customers: p.customers.map((entry, i) => i === index ? { ...entry, phone: e.target.value } : entry) }))} /></FormControl></HStack>)}</VStack></Box>
              <FormControl><FormLabel>Note</FormLabel><Input value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} placeholder="Booking note" /></FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter><HStack><Button variant="outline" onClick={bookingModal.onClose}>Cancel</Button><Button isLoading={saving} onClick={() => void saveBooking()}>{formMode === "create" ? "Create Booking" : "Save Changes"}</Button></HStack></ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={foodModal.isOpen} onClose={foodModal.onClose} size="4xl" closeOnOverlayClick={false}>
        <ModalOverlay /><ModalContent><ModalHeader>Food / Product Order to Dip & Dash</ModalHeader><ModalCloseButton />
          <ModalBody>
            <VStack align="stretch" spacing={3}>
              <Box p={3} borderRadius="12px" border="1px solid rgba(132,79,52,0.18)" bg="#FFFCF7"><Text fontWeight={800}>{foodBooking?.bookingNumber ?? "-"}</Text><Text fontSize="sm" color="#6D584E">{foodBooking?.primaryCustomerName} ({foodBooking?.primaryCustomerPhone}) • {foodBooking?.resourceLabel}</Text></Box>
              <FormControl><FormLabel>Search Menu/Product</FormLabel><Input value={foodSearch} onChange={(e) => setFoodSearch(e.target.value)} placeholder="Type to filter items, combos, products" /></FormControl>
              {foodLines.map((line) => (
                <SimpleGrid key={line.id} columns={{ base: 1, md: 4 }} spacing={3} border="1px solid rgba(132,79,52,0.14)" borderRadius="10px" p={3}>
                  <FormControl><FormLabel>Type</FormLabel><Select value={line.lineType} onChange={(e) => updateFoodLine(line.id, { lineType: e.target.value as FoodLineType, refId: "" })}><option value="item">Item</option><option value="combo">Combo</option><option value="product">Product</option></Select></FormControl>
                  <FormControl><FormLabel>Selection</FormLabel><Select value={line.refId} onChange={(e) => updateFoodLine(line.id, { refId: e.target.value })}><option value="">Select</option>{getFilteredOptions(line.lineType).map((option) => <option key={`${line.id}-${option.id}`} value={option.id}>{option.label} ({formatINR(option.unitPrice)})</option>)}</Select></FormControl>
                  <FormControl><FormLabel>Quantity</FormLabel><Input type="number" min={1} value={line.quantity} onChange={(e) => updateFoodLine(line.id, { quantity: e.target.value })} /></FormControl>
                  <FormControl><FormLabel>Action</FormLabel><Button variant="outline" size="sm" onClick={() => removeFoodLine(line.id)} isDisabled={foodLines.length <= 1}>Remove</Button></FormControl>
                </SimpleGrid>
              ))}
              <HStack justify="space-between"><Button leftIcon={<FiPlus size={14} />} variant="outline" onClick={() => setFoodLines((prev) => [...prev, createFoodLine()])}>Add Line</Button><Text fontWeight={800}>Draft Total: {formatINR(foodDraftTotal)}</Text></HStack>
              <Text fontSize="sm" color="#705A50">Save pannina order Dip & Dash staff pending list la <b>snooker</b> type-ah varum.</Text>
            </VStack>
          </ModalBody>
          <ModalFooter><HStack><Button variant="outline" onClick={foodModal.onClose}>Cancel</Button><Button isLoading={saving} onClick={() => void saveFoodOrder()}>Send to Dip & Dash</Button></HStack></ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={checkoutModal.isOpen} onClose={checkoutModal.onClose} size="lg" closeOnOverlayClick={false}>
        <ModalOverlay /><ModalContent><ModalHeader>Checkout Booking</ModalHeader><ModalCloseButton />
          <ModalBody>
            <VStack align="stretch" spacing={3}>
              <Box p={3} borderRadius="12px" border="1px solid rgba(132,79,52,0.18)" bg="#FFFCF7"><Text fontWeight={800}>{checkoutBooking?.resourceLabel ?? "-"}</Text><Text fontSize="sm" color="#6D584E">{checkoutBooking?.primaryCustomerName ?? "-"} ({checkoutBooking?.primaryCustomerPhone ?? "-"})</Text></Box>
              <FormControl><FormLabel>Checkout Time</FormLabel><Input type="datetime-local" value={checkoutAtLocal} onChange={(e) => setCheckoutAtLocal(e.target.value)} /></FormControl>
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}><FormControl><FormLabel>Game Amount (System)</FormLabel><Input value={formatINR(checkoutSystemAmount)} readOnly /></FormControl><FormControl><FormLabel>Food & Beverage</FormLabel><Input value={formatINR(checkoutFoodAmount)} readOnly /></FormControl></SimpleGrid>
              <FormControl><FormLabel>Final Amount (Editable)</FormLabel><Input type="number" min={0} value={checkoutFinalAmount} onChange={(e) => setCheckoutFinalAmount(e.target.value)} /></FormControl>
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}><FormControl><FormLabel>Payment Status</FormLabel><Select value={checkoutPaymentStatus} onChange={(e) => setCheckoutPaymentStatus(e.target.value as "pending" | "paid")}><option value="pending">Pending</option><option value="paid">Paid</option></Select></FormControl><FormControl isDisabled={checkoutPaymentStatus !== "paid"}><FormLabel>Payment Mode</FormLabel><Select value={checkoutPaymentMode} onChange={(e) => setCheckoutPaymentMode(e.target.value as GamingPaymentMode)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></Select></FormControl></SimpleGrid>
              <Text fontSize="sm" color="#705A50">Paid select pannina linked Dip & Dash food order auto-paid invoice queue ku pogum.</Text>
            </VStack>
          </ModalBody>
          <ModalFooter><HStack><Button variant="outline" onClick={checkoutModal.onClose}>Cancel</Button><Button isLoading={saving} onClick={() => void confirmCheckout()}>Confirm Checkout</Button></HStack></ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  );
};

