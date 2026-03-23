import { Box, Button, HStack, Table, Tbody, Td, Text, Th, Thead, Tr, VStack } from "@chakra-ui/react";

import { usePos } from "@/app/PosContext";
import { formatINR } from "@/utils/currency";

type StaffTablesPageProps = {
  onResumeToBilling?: () => void;
};

export const StaffTablesPage = ({ onResumeToBilling }: StaffTablesPageProps) => {
  const { pendingBills, resumePending } = usePos();
  const dineInBills = pendingBills.filter((bill) => bill.orderType === "dine_in");

  return (
    <VStack align="stretch" spacing={4}>
      <VStack align="start" spacing={0}>
        <Text fontWeight={900} color="#2A1A14" fontSize="xl">
          Tables
        </Text>
        <Text fontSize="sm" color="#705B52">
          Dine-in pending orders with table mapping.
        </Text>
      </VStack>

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
              <Th>Table</Th>
              <Th isNumeric>Total</Th>
              <Th>Action</Th>
            </Tr>
          </Thead>
          <Tbody>
            {dineInBills.length ? (
              dineInBills.map((bill) => (
                <Tr key={bill.localOrderId}>
                  <Td fontWeight={700}>{bill.invoiceNumber}</Td>
                  <Td>{bill.customerName}</Td>
                  <Td>{bill.tableLabel ?? "-"}</Td>
                  <Td isNumeric>{formatINR(bill.totalAmount)}</Td>
                  <Td>
                    <HStack>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={async () => {
                          await resumePending(bill.localOrderId);
                          onResumeToBilling?.();
                        }}
                      >
                        Resume
                      </Button>
                    </HStack>
                  </Td>
                </Tr>
              ))
            ) : (
              <Tr>
                <Td colSpan={5}>
                  <Box py={8} textAlign="center" color="#7A6258">
                    No pending dine-in tables.
                  </Box>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </Box>
    </VStack>
  );
};
