import {
  Badge,
  Box,
  FormControl,
  FormLabel,
  HStack,
  Select,
  SimpleGrid,
  Switch,
  Text,
  VStack
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonTable } from "@/components/feedback/SkeletonTable";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppInput } from "@/components/ui/AppInput";
import { DataTable } from "@/components/ui/DataTable";
import { useAppToast } from "@/hooks/useAppToast";
import { ingredientsService } from "@/services/ingredients.service";
import type { StockAuditData } from "@/types/ingredient";
import { extractErrorMessage } from "@/utils/api-error";
import { formatQuantity, formatQuantityWithUnit } from "@/utils/quantity";

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const PaginationControls = ({
  page,
  totalPages,
  total,
  showing,
  onPageChange
}: {
  page: number;
  totalPages: number;
  total: number;
  showing: number;
  onPageChange: (next: number) => void;
}) => (
  <HStack justify="space-between" mt={4} flexWrap="wrap" gap={3}>
    <Text color="#705B52" fontSize="sm">
      Showing {showing} of {total} records
    </Text>
    <HStack>
      <AppButton variant="outline" isDisabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </AppButton>
      <Text fontWeight={700}>
        Page {page} of {totalPages}
      </Text>
      <AppButton variant="outline" isDisabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Next
      </AppButton>
    </HStack>
  </HStack>
);

export const StockAuditPage = () => {
  const toast = useAppToast();
  const [date, setDate] = useState(getTodayDate());
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [staffId, setStaffId] = useState("");
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StockAuditData | null>(null);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const response = await ingredientsService.getStockAudit({
        date,
        page,
        limit,
        staffId: staffId || undefined
      });
      setData(response.data);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Unable to fetch stock audit data."));
    } finally {
      setLoading(false);
    }
  }, [date, limit, page, staffId, toast]);

  useEffect(() => {
    void fetchAudit();
  }, [fetchAudit]);

  useEffect(() => {
    setPage(1);
  }, [date, limit, staffId]);

  const staffOptions = useMemo(() => {
    if (!data?.reports.length) {
      return [];
    }
    const map = new Map<string, string>();
    data.reports.forEach((report) => {
      if (!map.has(report.staffId)) {
        map.set(report.staffId, report.staffName);
      }
    });
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [data?.reports]);

  const reportColumns = useMemo(
    () => [
      { key: "staffName", header: "Staff" },
      { key: "reportDate", header: "Business Date" },
      { key: "closingSlot", header: "Slot" },
      {
        key: "totalExpectedRemaining",
        header: "Expected",
        render: (row: StockAuditData["reports"][number]) => `${formatQuantity(row.totalExpectedRemaining)} (mixed units)`
      },
      {
        key: "totalReportedRemaining",
        header: "Reported",
        render: (row: StockAuditData["reports"][number]) => `${formatQuantity(row.totalReportedRemaining)} (mixed units)`
      },
      {
        key: "totalVariance",
        header: "Variance",
        render: (row: StockAuditData["reports"][number]) => (
          <Text color={Math.abs(row.totalVariance) > 0.0001 ? "red.600" : "green.700"}>
            {`${formatQuantity(row.totalVariance)} (mixed units)`}
          </Text>
        )
      },
      {
        key: "submittedAt",
        header: "Submitted At",
        render: (row: StockAuditData["reports"][number]) => new Date(row.submittedAt).toLocaleString("en-IN")
      }
    ],
    []
  );

  const itemRows = useMemo(() => {
    if (!data) {
      return [];
    }
    if (!mismatchOnly) {
      return data.items.rows;
    }
    return data.items.rows.filter((row) => row.isMismatch);
  }, [data, mismatchOnly]);

  const itemTableRows = useMemo(
    () =>
      itemRows.map((row, index) => ({
        ...row,
        id: `${row.reportId}-${row.ingredientId}-${index}`
      })),
    [itemRows]
  );

  const itemColumns = useMemo(
    () => [
      {
        key: "ingredientName",
        header: "Ingredient",
        render: (row: StockAuditData["items"]["rows"][number]) => (
          <VStack align="start" spacing={0}>
            <Text fontWeight={700}>{row.ingredientName}</Text>
            <Text fontSize="xs" color="#6D584E">
              {row.staffName} | {new Date(row.submittedAt).toLocaleString("en-IN")}
            </Text>
          </VStack>
        )
      },
      {
        key: "allocatedQuantity",
        header: "Allocated",
        render: (row: StockAuditData["items"]["rows"][number]) =>
          formatQuantityWithUnit(row.allocatedQuantity, row.unit)
      },
      {
        key: "usedQuantity",
        header: "Used",
        render: (row: StockAuditData["items"]["rows"][number]) => formatQuantityWithUnit(row.usedQuantity, row.unit)
      },
      {
        key: "expectedRemainingQuantity",
        header: "Expected Rem.",
        render: (row: StockAuditData["items"]["rows"][number]) =>
          formatQuantityWithUnit(row.expectedRemainingQuantity, row.unit)
      },
      {
        key: "reportedRemainingQuantity",
        header: "Reported Rem.",
        render: (row: StockAuditData["items"]["rows"][number]) =>
          formatQuantityWithUnit(row.reportedRemainingQuantity, row.unit)
      },
      {
        key: "varianceQuantity",
        header: "Variance",
        render: (row: StockAuditData["items"]["rows"][number]) => (
          <Text color={row.isMismatch ? "red.600" : "green.700"}>
            {formatQuantityWithUnit(row.varianceQuantity, row.unit)}
          </Text>
        )
      }
    ],
    []
  );

  const totalReports = data?.stats.totalReports ?? 0;
  const staffSubmitted = data?.stats.staffSubmitted ?? 0;
  const totalIngredients = data?.stats.totalIngredients ?? 0;
  const mismatchedIngredients = data?.stats.mismatchedIngredients ?? 0;
  const matchedIngredients = data?.stats.matchedIngredients ?? 0;
  const balancedReports = useMemo(
    () => (data?.reports ?? []).filter((report) => Math.abs(report.totalVariance) <= 0.0001).length,
    [data?.reports]
  );
  const mismatchRate = totalIngredients > 0 ? (mismatchedIngredients / totalIngredients) * 100 : 0;
  const matchRate = totalIngredients > 0 ? (matchedIngredients / totalIngredients) * 100 : 0;

  return (
    <VStack align="stretch" spacing={6}>
      <PageHeader
        title="Stock Audit"
        subtitle="Audit staff closing reports against expected ingredient balance with mismatch visibility."
      />

      <AppCard>
        <SimpleGrid columns={{ base: 1, md: 2, xl: 6 }} spacing={4}>
          <AppInput
            label="Date"
            type="date"
            value={date}
            onChange={(event) => setDate((event.target as HTMLInputElement).value)}
          />
          <FormControl>
            <FormLabel>Staff</FormLabel>
            <Select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
              <option value="">All Staff</option>
              {staffOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel>Records per page</FormLabel>
            <Select
              value={String(limit)}
              onChange={(event) => {
                setLimit(Number(event.target.value) || 20);
                setPage(1);
              }}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </Select>
          </FormControl>
          <FormControl display="flex" alignItems="center" gap={3} pt={8}>
            <Switch isChecked={mismatchOnly} onChange={(event) => setMismatchOnly(event.target.checked)} />
            <Text fontWeight={600}>Mismatch only</Text>
          </FormControl>
          <Box p={3} borderRadius="12px" bg="rgba(132, 79, 52, 0.08)" border="1px solid rgba(132, 79, 52, 0.18)">
            <Text fontSize="xs" color="#6D584E" fontWeight={700}>
              POS Billing
            </Text>
            <Text fontWeight={800} color={data?.posBillingControl.isBillingEnabled ? "green.700" : "red.700"}>
              {data?.posBillingControl.isBillingEnabled ? "Enabled" : "Paused"}
            </Text>
            {data?.posBillingControl.reason ? (
              <Text mt={1} fontSize="xs" color="#6D584E">
                {data.posBillingControl.reason}
              </Text>
            ) : null}
          </Box>
          <Box p={3} borderRadius="12px" bg="rgba(132, 79, 52, 0.08)" border="1px solid rgba(132, 79, 52, 0.18)">
            <Text fontSize="xs" color="#6D584E" fontWeight={700}>
              Mismatched Rows
            </Text>
            <Text fontWeight={800}>{data?.stats.mismatchedIngredients ?? 0}</Text>
          </Box>
        </SimpleGrid>
      </AppCard>

      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
        <AppCard>
          <Text color="#725D53" fontSize="sm">
            Reports
          </Text>
          <Text mt={1} fontSize="2xl" fontWeight={900}>
            {totalReports}
          </Text>
        </AppCard>
        <AppCard>
          <Text color="#725D53" fontSize="sm">
            Staff Submitted
          </Text>
          <Text mt={1} fontSize="2xl" fontWeight={900}>
            {staffSubmitted}
          </Text>
        </AppCard>
        <AppCard>
          <Text color="#725D53" fontSize="sm">
            Ingredients Audited
          </Text>
          <Text mt={1} fontSize="2xl" fontWeight={900}>
            {totalIngredients}
          </Text>
          <Text mt={1} fontSize="xs" color="#6D584E">
            Mismatch rows: {mismatchedIngredients}
          </Text>
        </AppCard>
        <AppCard>
          <Text color="#725D53" fontSize="sm">
            Audit Accuracy
          </Text>
          <Text mt={1} fontSize="2xl" fontWeight={900}>
            {`${formatQuantity(matchRate)}%`}
          </Text>
          <Text mt={1} fontSize="xs" color="#6D584E">
            Balanced reports: {balancedReports}
          </Text>
        </AppCard>
      </SimpleGrid>

      <AppCard>
        <HStack justify="space-between" flexWrap="wrap" gap={3}>
          <VStack align="start" spacing={0}>
            <Text fontWeight={800}>Audit Health</Text>
            <Text fontSize="sm" color="#6D584E">
              Match rate: {`${formatQuantity(matchRate)}%`} | Mismatch rate: {`${formatQuantity(mismatchRate)}%`}
            </Text>
          </VStack>
          <HStack spacing={2}>
            <Badge colorScheme="red" borderRadius="full" px={3} py={1}>
              Mismatch {mismatchedIngredients}
            </Badge>
            <Badge colorScheme="green" borderRadius="full" px={3} py={1}>
              Matched {matchedIngredients}
            </Badge>
          </HStack>
        </HStack>
      </AppCard>

      <AppCard title="Closing Reports">
        {loading ? (
          <SkeletonTable />
        ) : (
          <DataTable
            columns={reportColumns}
            rows={data?.reports ?? []}
            emptyState={<EmptyState title="No closing reports" description="No report submitted for selected date." />}
          />
        )}
      </AppCard>

      <AppCard title="Ingredient-Level Audit">
        {loading ? (
          <SkeletonTable />
        ) : (
          <>
            <DataTable
              columns={itemColumns}
              rows={itemTableRows}
              emptyState={
                <EmptyState
                  title="No audit rows"
                  description="No ingredient rows found for selected date and filters."
                />
              }
            />
            <PaginationControls
              page={data?.items.pagination.page ?? 1}
              totalPages={data?.items.pagination.totalPages ?? 1}
              total={data?.items.pagination.total ?? 0}
              showing={itemTableRows.length}
              onPageChange={setPage}
            />
          </>
        )}
      </AppCard>
    </VStack>
  );
};
