import {
  Box,
  Button,
  HStack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack
} from "@chakra-ui/react";
import { FiPlay, FiPlus } from "react-icons/fi";

import { formatINR } from "@/utils/currency";
import type { PendingBillSummary } from "@/types/pos";

type RecentBillsTableCardProps = {
  bills: PendingBillSummary[];
  onNewOrder: () => void;
  onResume: (localOrderId: string) => void;
};

export const RecentBillsTableCard = ({
  bills,
  onNewOrder,
  onResume
}: RecentBillsTableCardProps) => {
  const toLabel = (value: string | null | undefined, fallback: string) => {
    if (!value || typeof value !== "string") {
      return fallback;
    }
    return value.replace(/_/g, " ");
  };

  const getKitchenBadgeStyles = (status: PendingBillSummary["kitchenStatus"]) => {
    if (status === "ready" || status === "served") {
      return { bg: "green.100", color: "green.700", label: status === "served" ? "Served" : "Ready" };
    }
    if (status === "preparing") {
      return { bg: "orange.100", color: "orange.700", label: "Preparing" };
    }
    if (status === "queued") {
      return { bg: "blue.100", color: "blue.700", label: "Queued" };
    }
    return { bg: "gray.100", color: "gray.700", label: "Not Sent" };
  };

  return (
    <VStack
      align="stretch"
      spacing={3}
      p={4}
      borderRadius="14px"
      border="1px solid"
      borderColor="rgba(132, 79, 52, 0.2)"
      bg="white"
      boxShadow="sm"
      minH="540px"
    >
      <HStack justify="space-between">
        <VStack align="start" spacing={0}>
          <Text fontWeight={900} color="#2A1A14">
            Pending Orders
          </Text>
          <Text fontSize="sm" color="#7A6258">
            All pending orders from this POS. Click a row to resume billing.
          </Text>
        </VStack>
        <Button leftIcon={<FiPlus />} onClick={onNewOrder}>
          New Order
        </Button>
      </HStack>

      {bills.length ? (
        <Box border="1px solid" borderColor="rgba(132, 79, 52, 0.2)" borderRadius="12px" overflow="hidden">
          <Table size="sm" variant="simple">
            <Thead bg="rgba(247, 238, 229, 0.9)">
              <Tr>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                <Th>Order Type</Th>
                <Th>Kitchen</Th>
                <Th>Table</Th>
                <Th isNumeric>Items</Th>
                <Th isNumeric>Total</Th>
                <Th>Updated</Th>
                <Th>Resume</Th>
              </Tr>
            </Thead>
            <Tbody>
              {bills.map((bill) => {
                return (
                  <Tr
                    key={bill.localOrderId}
                    cursor="pointer"
                    _hover={{ bg: "rgba(247, 238, 229, 0.45)" }}
                    onClick={() => onResume(bill.localOrderId)}
                  >
                    <Td fontWeight={700}>{bill.invoiceNumber}</Td>
                    <Td>
                      <VStack align="start" spacing={0}>
                        <Text>{bill.customerName}</Text>
                        <Text fontSize="xs" color="#7A6258">
                          {bill.customerPhone}
                        </Text>
                      </VStack>
                    </Td>
                    <Td textTransform="capitalize">{toLabel(bill.orderType, "takeaway")}</Td>
                    <Td>
                      {(() => {
                        const badge = getKitchenBadgeStyles(bill.kitchenStatus);
                        return (
                          <Box
                            px={2.5}
                            py={1}
                            borderRadius="full"
                            fontSize="xs"
                            fontWeight={700}
                            bg={badge.bg}
                            color={badge.color}
                            w="fit-content"
                            textTransform="capitalize"
                          >
                            {badge.label}
                          </Box>
                        );
                      })()}
                    </Td>
                    <Td>{bill.tableLabel ?? "-"}</Td>
                    <Td isNumeric fontWeight={700}>
                      {bill.lineCount}
                    </Td>
                    <Td isNumeric fontWeight={700}>
                      {formatINR(bill.totalAmount)}
                    </Td>
                    <Td fontSize="xs" color="#7A6258">
                      {new Date(bill.updatedAt).toLocaleString()}
                    </Td>
                    <Td>
                      <Button
                        size="xs"
                        variant="outline"
                        leftIcon={<FiPlay />}
                        onClick={(event) => {
                          event.stopPropagation();
                          onResume(bill.localOrderId);
                        }}
                      >
                        Resume
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      ) : (
        <Box
          p={5}
          borderRadius="12px"
          border="1px dashed"
          borderColor="rgba(132, 79, 52, 0.25)"
          textAlign="center"
          color="#7A6258"
        >
          No pending orders. Start with a new order.
        </Box>
      )}
    </VStack>
  );
};
