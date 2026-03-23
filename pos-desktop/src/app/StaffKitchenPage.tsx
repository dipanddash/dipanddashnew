import {
  Box,
  Button,
  HStack,
  Select,
  Text,
  VStack
} from "@chakra-ui/react";
import { useMemo, useState } from "react";

import { usePos } from "@/app/PosContext";
import { PosDataTable, type PosTableColumn } from "@/components/common/PosDataTable";
import type { KitchenStatus, PosOrder } from "@/types/pos";

const statusOptions: Array<{ label: string; value: KitchenStatus }> = [
  { label: "Queued", value: "queued" },
  { label: "Preparing", value: "preparing" },
  { label: "Ready", value: "ready" },
  { label: "Served", value: "served" }
];

const formatLineText = (line: PosOrder["lines"][number]) => {
  const addOns = line.addOns ?? [];
  const addOnText = addOns.length
    ? ` | Add-ons: ${addOns.map((addOn) => `${addOn.name} x${addOn.quantity * line.quantity}`).join(", ")}`
    : "";
  return `${line.name} x${line.quantity}${addOnText}`;
};

const toLabel = (value: string | null | undefined, fallback: string) => {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  return value.replace(/_/g, " ");
};

const resolveKitchenStatus = (value: string | null | undefined): KitchenStatus => {
  if (value === "queued" || value === "preparing" || value === "ready" || value === "served") {
    return value;
  }
  return "queued";
};

export const StaffKitchenPage = () => {
  const { kitchenOrders, refreshKitchenOrders, updateKitchenStatus } = usePos();
  const [statusDrafts, setStatusDrafts] = useState<Record<string, KitchenStatus>>({});

  const rows = useMemo(() => kitchenOrders, [kitchenOrders]);

  const columns = useMemo<PosTableColumn<PosOrder>[]>(
    () => [
      {
        key: "invoiceNumber",
        header: "Invoice",
        render: (order) => <Text fontWeight={700}>{order.invoiceNumber}</Text>
      },
      {
        key: "customer",
        header: "Customer",
        render: (order) => (
          <VStack align="start" spacing={0}>
            <Text>{order.customer?.name ?? "Walk-in"}</Text>
            <Text fontSize="xs" color="#7A6258">
              {order.customer?.phone ?? "-"}
            </Text>
          </VStack>
        )
      },
      {
        key: "orderType",
        header: "Type",
        render: (order) => <Text textTransform="capitalize">{toLabel(order.orderType, "takeaway")}</Text>
      },
      {
        key: "items",
        header: "Items",
        render: (order) => (
          <VStack align="start" spacing={1} maxW="460px">
            {order.lines.map((line) => (
              <Text key={line.lineId} fontSize="xs" color="#5E4A41">
                {formatLineText(line)}
              </Text>
            ))}
          </VStack>
        )
      },
      {
        key: "status",
        header: "Status",
        render: (order) => {
          const kitchenStatus = resolveKitchenStatus(order.kitchenStatus);
          return (
            <Text textTransform="capitalize" fontWeight={700} color="#7A2620">
              {toLabel(kitchenStatus, "queued")}
            </Text>
          );
        }
      },
      {
        key: "update",
        header: "Update",
        alwaysVisible: true,
        render: (order) => {
          const kitchenStatus = resolveKitchenStatus(order.kitchenStatus);
          return (
            <HStack>
              <Select
                size="sm"
                value={statusDrafts[order.localOrderId] ?? kitchenStatus}
                onChange={(event) =>
                  setStatusDrafts((previous) => ({
                    ...previous,
                    [order.localOrderId]: event.target.value as KitchenStatus
                  }))
                }
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void updateKitchenStatus(order.localOrderId, statusDrafts[order.localOrderId] ?? kitchenStatus)
                }
              >
                Save
              </Button>
            </HStack>
          );
        }
      },
      {
        key: "tableLabel",
        header: "Table",
        render: (order) => order.tableLabel ?? "-"
      }
    ],
    [statusDrafts, updateKitchenStatus]
  );

  return (
    <VStack align="stretch" spacing={4}>
      <HStack justify="space-between" flexWrap="wrap" gap={3}>
        <VStack align="start" spacing={0}>
          <Text fontWeight={900} color="#2A1A14" fontSize="xl">
            Kitchen Queue
          </Text>
          <Text fontSize="sm" color="#705B52">
            Orders sent from billing with item, combo, free item and add-on details.
          </Text>
        </VStack>
        <Button variant="outline" onClick={() => void refreshKitchenOrders()}>
          Refresh
        </Button>
      </HStack>

      <PosDataTable
        rows={rows}
        columns={columns}
        getRowId={(order) => order.localOrderId}
        emptyMessage='No kitchen orders yet. Use "Send To Kitchen" from billing.'
        maxColumns={6}
      />
    </VStack>
  );
};
