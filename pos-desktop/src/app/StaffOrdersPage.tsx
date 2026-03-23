import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Image,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
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
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { usePosAuth } from "@/app/PosAuthContext";
import { usePos } from "@/app/PosContext";
import type { PosOrder } from "@/types/pos";
import logo from "@/assets/logo.png";
import {
  buildBillDocumentHtml,
  COMPANY_ADDRESS,
  COMPANY_BRANCH,
  COMPANY_NAME,
  COMPANY_REGISTRY,
  formatRs,
  getLineBaseTotal,
  openBillInPrintFrame
} from "@/utils/bill-print";

const toOrderTypeLabel = (value: PosOrder["orderType"] | string | null | undefined) => {
  if (typeof value !== "string" || !value.trim()) {
    return "takeaway";
  }
  return value.replace(/_/g, " ");
};

export const StaffOrdersPage = () => {
  const toast = useToast();
  const { session } = usePosAuth();
  const { completedBills, getOrderById, refreshCompletedBills } = usePos();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [previewOrder, setPreviewOrder] = useState<PosOrder | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const previewModal = useDisclosure();

  const filteredBills = useMemo(() => {
    const query = search.trim().toLowerCase();
    return completedBills.filter((bill) => {
      const searchable = [bill.invoiceNumber, bill.customerName, bill.customerPhone].some((value) =>
        value.toLowerCase().includes(query)
      );

      if (!searchable) {
        return false;
      }

      const billDate = new Date(bill.updatedAt);
      if (Number.isNaN(billDate.getTime())) {
        return !dateFrom && !dateTo;
      }

      const billDay = billDate.toISOString().slice(0, 10);
      const fromOk = !dateFrom || billDay >= dateFrom;
      const toOk = !dateTo || billDay <= dateTo;
      return fromOk && toOk;
    });
  }, [completedBills, dateFrom, dateTo, search]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredBills.length / rowsPerPage)), [filteredBills.length, rowsPerPage]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedBills = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * rowsPerPage;
    return filteredBills.slice(offset, offset + rowsPerPage);
  }, [filteredBills, page, rowsPerPage, totalPages]);

  const openPreview = useCallback(
    async (localOrderId: string) => {
      setLoadingPreview(true);
      try {
        const order = await getOrderById(localOrderId);
        if (!order) {
          toast({
            status: "warning",
            title: "Invoice not found"
          });
          return;
        }
        setPreviewOrder(order);
        previewModal.onOpen();
      } finally {
        setLoadingPreview(false);
      }
    },
    [getOrderById, previewModal, toast]
  );

  const printByOrderId = useCallback(
    async (localOrderId: string) => {
      const order = await getOrderById(localOrderId);
      if (!order) {
        toast({
          status: "warning",
          title: "Unable to find bill for print"
        });
        return;
      }
      const printable = buildBillDocumentHtml(order, session?.fullName);
      const success = openBillInPrintFrame(printable);
      if (!success) {
        toast({
          status: "error",
          title: "Unable to open print window"
        });
      }
    },
    [getOrderById, session?.fullName, toast]
  );

  const handleRowsPerPageChange = (value: string) => {
    setRowsPerPage(Number(value) || 10);
    setPage(1);
  };

  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    setPage(1);
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const displayPage = Math.min(page, totalPages);

  return (
    <VStack align="stretch" spacing={4}>
      <HStack justify="space-between" flexWrap="wrap" gap={3}>
        <VStack align="start" spacing={0}>
          <Text fontWeight={900} color="#2A1A14" fontSize="xl">
            Completed Invoices
          </Text>
          <Text fontSize="sm" color="#705B52">
            Staff completed bills with quick preview and print.
          </Text>
        </VStack>
        <HStack align="end" flexWrap="wrap" gap={3}>
          <FormControl w="300px">
            <FormLabel fontSize="sm">Search</FormLabel>
            <Input
              placeholder="Search invoice/customer/phone"
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              bg="white"
            />
          </FormControl>
          <FormControl w="170px">
            <FormLabel fontSize="sm">From Date</FormLabel>
            <Input type="date" value={dateFrom} onChange={(event) => handleDateFromChange(event.target.value)} bg="white" />
          </FormControl>
          <FormControl w="170px">
            <FormLabel fontSize="sm">To Date</FormLabel>
            <Input type="date" value={dateTo} onChange={(event) => handleDateToChange(event.target.value)} bg="white" />
          </FormControl>
          <FormControl w="150px">
            <FormLabel fontSize="sm">Rows per page</FormLabel>
            <Select value={String(rowsPerPage)} onChange={(event) => handleRowsPerPageChange(event.target.value)} bg="white">
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </Select>
          </FormControl>
          <Button variant="outline" onClick={() => void refreshCompletedBills()}>
            Refresh
          </Button>
        </HStack>
      </HStack>

      <Box
        border="1px solid"
        borderColor="rgba(132, 79, 52, 0.2)"
        borderRadius="14px"
        overflow="hidden"
        bg="white"
        boxShadow="sm"
      >
        <Table size="sm">
          <Thead bg="rgba(247, 238, 229, 0.9)">
            <Tr>
              <Th>Invoice</Th>
              <Th>Customer</Th>
              <Th>Order Type</Th>
              <Th isNumeric>Total</Th>
              <Th>Updated</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {pagedBills.length ? (
              pagedBills.map((bill) => (
                <Tr key={bill.localOrderId}>
                  <Td fontWeight={700}>{bill.invoiceNumber}</Td>
                  <Td>
                    <VStack align="start" spacing={0}>
                      <Text>{bill.customerName}</Text>
                      <Text fontSize="xs" color="#7A6258">
                        {bill.customerPhone}
                      </Text>
                    </VStack>
                  </Td>
                  <Td textTransform="capitalize">{toOrderTypeLabel(bill.orderType)}</Td>
                  <Td isNumeric fontWeight={700}>
                    {formatRs(bill.totalAmount)}
                  </Td>
                  <Td fontSize="xs" color="#7A6258">
                    {new Date(bill.updatedAt).toLocaleString()}
                  </Td>
                  <Td>
                    <HStack>
                      <Button size="xs" variant="outline" onClick={() => void openPreview(bill.localOrderId)}>
                        View
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => void printByOrderId(bill.localOrderId)}>
                        Print
                      </Button>
                    </HStack>
                  </Td>
                </Tr>
              ))
            ) : (
              <Tr>
                <Td colSpan={6}>
                  <Box py={10} textAlign="center" color="#7A6258">
                    No completed invoices found for current filters.
                  </Box>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </Box>
      <HStack justify="space-between" flexWrap="wrap" gap={3}>
        <Text fontSize="sm" color="#705B52">
          Showing {pagedBills.length} of {filteredBills.length} invoices
        </Text>
        <HStack>
          <Button
            variant="outline"
            size="sm"
            isDisabled={displayPage <= 1}
            onClick={() => setPage((previous) => Math.max(1, previous - 1))}
          >
            Previous
          </Button>
          <Text fontWeight={700} fontSize="sm">
            Page {displayPage} of {totalPages}
          </Text>
          <Button
            variant="outline"
            size="sm"
            isDisabled={displayPage >= totalPages}
            onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
          >
            Next
          </Button>
        </HStack>
      </HStack>

      <Modal isOpen={previewModal.isOpen} onClose={previewModal.onClose} size="4xl" isCentered scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Invoice Preview</ModalHeader>
          <ModalCloseButton />
          <ModalBody bg="#F8F8F8">
            {loadingPreview ? <Text>Loading invoice...</Text> : null}
            {!loadingPreview && previewOrder ? (
              <Box
                maxW="780px"
                mx="auto"
                bg="white"
                border="1px dashed"
                borderColor="#C5D2E3"
                borderRadius="12px"
                px={{ base: 4, md: 8 }}
                py={{ base: 4, md: 6 }}
                fontFamily="'Courier New', monospace"
                color="#11223B"
              >
                <VStack spacing={2} align="center">
                  <Image src={logo} alt="Dip & Dash logo" h="30px" objectFit="contain" />
                  <Text fontWeight={800} fontSize="lg" letterSpacing="0.7px" textAlign="center">
                    {COMPANY_NAME}
                  </Text>
                  <Text fontWeight={700} fontSize="sm" textAlign="center">
                    {COMPANY_BRANCH}
                  </Text>
                  <Text fontSize="sm" textAlign="center" lineHeight={1.35}>
                    {COMPANY_ADDRESS[0]}
                    <br />
                    {COMPANY_ADDRESS[1]}
                    <br />
                    {COMPANY_ADDRESS[2]}
                  </Text>
                </VStack>

                <Box borderTop="1px dashed" borderColor="#A8BACF" mt={4} pt={3}>
                  <Text fontSize="sm" textAlign="center">
                    {COMPANY_REGISTRY[0]}
                    <br />
                    {COMPANY_REGISTRY[1]}
                    <br />
                    {COMPANY_REGISTRY[2]}
                  </Text>
                </Box>

                <Box borderTop="1px dashed" borderColor="#A8BACF" mt={4} pt={3}>
                  <Text textAlign="center" fontWeight={700} letterSpacing="0.8px">
                    TAX INVOICE
                  </Text>
                  <HStack justify="space-between" mt={2} fontSize="sm">
                    <Text>
                      <Text as="span" fontWeight={700}>
                        Bill No:
                      </Text>{" "}
                      {previewOrder.invoiceNumber}
                    </Text>
                    <Text>
                      <Text as="span" fontWeight={700}>
                        Bill Dt:
                      </Text>{" "}
                      {new Date(previewOrder.createdAt).toISOString().slice(0, 10)}
                    </Text>
                  </HStack>
                  <HStack justify="space-between" mt={1} fontSize="sm">
                    <Text>
                      <Text as="span" fontWeight={700}>
                        Customer:
                      </Text>{" "}
                      {previewOrder.customer?.name ?? "Walk-in Customer"}
                    </Text>
                    <Text>
                      <Text as="span" fontWeight={700}>
                        Cashier:
                      </Text>{" "}
                      {session?.fullName ?? "-"}
                    </Text>
                  </HStack>
                  {previewOrder.orderType === "dine_in" ? (
                    <HStack justify="space-between" mt={1} fontSize="sm">
                      <Text>
                        <Text as="span" fontWeight={700}>
                          Table:
                        </Text>{" "}
                        {previewOrder.tableLabel ?? "-"}
                      </Text>
                      <Text />
                    </HStack>
                  ) : null}
                </Box>

                <Box borderTop="1px dashed" borderColor="#A8BACF" mt={4} pt={3}>
                  <Text fontWeight={700} mb={2}>
                    Items List
                  </Text>
                  <HStack fontSize="sm" fontWeight={700} px={1}>
                    <Text flex={2}>Item</Text>
                    <Text flex={1} textAlign="center">
                      Qty
                    </Text>
                    <Text flex={1} textAlign="right">
                      Price
                    </Text>
                    <Text flex={1} textAlign="right">
                      Total
                    </Text>
                  </HStack>
                  <VStack align="stretch" spacing={1} mt={1}>
                    {previewOrder.lines.length ? (
                      previewOrder.lines.map((line) => (
                        <Fragment key={line.lineId}>
                          <HStack fontSize="sm" px={1} align="start">
                            <Text flex={2}>{line.name}</Text>
                            <Text flex={1} textAlign="center">
                              {Math.round(line.quantity)}
                            </Text>
                            <Text flex={1} textAlign="right">
                              {formatRs(line.unitPrice)}
                            </Text>
                            <Text flex={1} textAlign="right">
                              {formatRs(getLineBaseTotal(line))}
                            </Text>
                          </HStack>
                          {line.addOns.map((addOn) => (
                            <HStack key={addOn.addOnId} fontSize="sm" px={1} align="start" color="#355274">
                              <Text flex={2} pl={3}>
                                + {addOn.name}
                              </Text>
                              <Text flex={1} textAlign="center">
                                {Math.round(addOn.quantity * line.quantity)}
                              </Text>
                              <Text flex={1} textAlign="right">
                                {formatRs(addOn.unitPrice)}
                              </Text>
                              <Text flex={1} textAlign="right">
                                {formatRs(addOn.unitPrice * addOn.quantity * line.quantity)}
                              </Text>
                            </HStack>
                          ))}
                        </Fragment>
                      ))
                    ) : (
                      <Text fontSize="sm" px={1} color="#355274">
                        No items available in invoice payload.
                      </Text>
                    )}
                  </VStack>
                </Box>

                <Box borderTop="1px dashed" borderColor="#A8BACF" mt={4} pt={3}>
                  <VStack align="stretch" spacing={1} fontSize="sm">
                    <HStack justify="space-between">
                      <Text>Subtotal</Text>
                      <Text>{formatRs(previewOrder.totals.subtotal)}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text>Total GST</Text>
                      <Text>{formatRs(previewOrder.totals.taxAmount)}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text>Manual Discount</Text>
                      <Text>{formatRs(previewOrder.totals.manualDiscountAmount)}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text>Coupon Discount</Text>
                      <Text>{formatRs(previewOrder.totals.couponDiscountAmount)}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text>Total Discount</Text>
                      <Text>
                        {formatRs(
                          previewOrder.totals.itemDiscountAmount +
                            previewOrder.totals.couponDiscountAmount +
                            previewOrder.totals.manualDiscountAmount
                        )}
                      </Text>
                    </HStack>
                  </VStack>

                  <HStack
                    justify="space-between"
                    borderTop="1px dashed"
                    borderColor="#A8BACF"
                    mt={2}
                    pt={2}
                    fontSize="2xl"
                    fontWeight={900}
                    color="#001C45"
                  >
                    <Text>Final Amount</Text>
                    <Text>{formatRs(previewOrder.totals.totalAmount)}</Text>
                  </HStack>
                </Box>
              </Box>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" mr={2} onClick={previewModal.onClose}>
              Close
            </Button>
            {previewOrder ? (
              <Button
                onClick={() => {
                  void printByOrderId(previewOrder.localOrderId);
                }}
              >
                Print
              </Button>
            ) : null}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  );
};
