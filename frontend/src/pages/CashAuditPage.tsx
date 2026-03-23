import { HStack, Select, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonTable } from "@/components/feedback/SkeletonTable";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppInput } from "@/components/ui/AppInput";
import { DataTable } from "@/components/ui/DataTable";
import { useAppToast } from "@/hooks/useAppToast";
import { cashAuditService } from "@/services/cash-audit.service";
import {
  CASH_AUDIT_DENOMINATIONS,
  type CashAuditRecord,
  type CashAuditRecordsResponse,
  type CashAuditStatsResponse
} from "@/types/cash-audit";
import { extractErrorMessage } from "@/utils/api-error";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value);

const formatDateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
      })
    : "-";

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const getSevenDaysBefore = () => {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return date.toISOString().slice(0, 10);
};

const StatCard = ({ label, value, helper }: { label: string; value: string; helper?: string }) => (
  <AppCard minH="120px">
    <Text color="#7A6258" fontSize="sm" fontWeight={700}>
      {label}
    </Text>
    <Text mt={2} color="#2A1A14" fontSize="2xl" fontWeight={900}>
      {value}
    </Text>
    {helper ? (
      <Text mt={1} color="#8A6F63" fontSize="xs">
        {helper}
      </Text>
    ) : null}
  </AppCard>
);

const buildDenominationText = (counts: CashAuditRecord["denominationCounts"]) => {
  const segments = CASH_AUDIT_DENOMINATIONS.map((denomination) => {
    const key = String(denomination);
    const count = Number(counts[key] ?? 0);
    return count > 0 ? `₹${denomination} x ${count}` : null;
  }).filter(Boolean);

  return segments.length ? segments.join(" | ") : "No denominations counted";
};

export const CashAuditPage = () => {
  const toast = useAppToast();
  const [stats, setStats] = useState<CashAuditStatsResponse | null>(null);
  const [records, setRecords] = useState<CashAuditRecord[]>([]);
  const [pagination, setPagination] = useState<CashAuditRecordsResponse["pagination"]>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1
  });
  const [dateFrom, setDateFrom] = useState(getSevenDaysBefore());
  const [dateTo, setDateTo] = useState(getTodayDate());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(
    async (nextPage: number, nextLimit: number) => {
      setLoading(true);
      try {
        const [statsResponse, recordsResponse] = await Promise.all([
          cashAuditService.getAdminStats({
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined
          }),
          cashAuditService.getAdminRecords({
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            search: search.trim() || undefined,
            page: nextPage,
            limit: nextLimit
          })
        ]);

        setStats(statsResponse.data);
        setRecords(recordsResponse.data.records);
        setPagination(recordsResponse.data.pagination);
      } catch (error) {
        toast.error(extractErrorMessage(error, "Unable to load cash audit records."));
      } finally {
        setLoading(false);
      }
    },
    [dateFrom, dateTo, search, toast]
  );

  useEffect(() => {
    void fetchData(pagination.page, pagination.limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = useCallback(() => {
    void fetchData(1, pagination.limit);
  }, [fetchData, pagination.limit]);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      void fetchData(nextPage, pagination.limit);
    },
    [fetchData, pagination.limit]
  );

  const handleLimitChange = useCallback(
    (nextLimit: number) => {
      void fetchData(1, nextLimit);
    },
    [fetchData]
  );

  const columns = useMemo(
    () =>
      [
        {
          key: "auditDate",
          header: "Audit",
          render: (row: CashAuditRecord) => (
            <VStack align="start" spacing={0}>
              <Text fontWeight={800}>{row.auditDate}</Text>
              <Text color="#7B655A" fontSize="xs">
                {formatDateTime(row.createdAt)}
              </Text>
            </VStack>
          )
        },
        {
          key: "countedAmount",
          header: "Counted Amount",
          render: (row: CashAuditRecord) => formatCurrency(row.countedAmount)
        },
        {
          key: "staffCashTakenAmount",
          header: "Staff Cash Taken",
          render: (row: CashAuditRecord) => formatCurrency(row.staffCashTakenAmount)
        },
        {
          key: "differenceFromPrevious",
          header: "Difference vs Previous",
          render: (row: CashAuditRecord) => (
            <Text color={row.differenceFromPrevious >= 0 ? "green.700" : "red.700"} fontWeight={700}>
              {row.differenceFromPrevious >= 0 ? "+" : ""}
              {formatCurrency(row.differenceFromPrevious)}
            </Text>
          )
        },
        {
          key: "denominations",
          header: "Denomination Count",
          render: (row: CashAuditRecord) => (
            <VStack align="start" spacing={0}>
              <Text fontSize="sm">{buildDenominationText(row.denominationCounts)}</Text>
              <Text fontSize="xs" color="#7B655A">
                Pieces: {row.totalPieces}
              </Text>
            </VStack>
          )
        },
        {
          key: "enteredBy",
          header: "Entered / Approved",
          render: (row: CashAuditRecord) => (
            <VStack align="start" spacing={0}>
              <Text fontWeight={700}>
                {row.createdByUserName} (@{row.createdByUsername})
              </Text>
              <Text color="#7B655A" fontSize="xs">
                Approved by {row.approvedByAdminName}
              </Text>
            </VStack>
          )
        }
      ] as Array<{
        key: string;
        header: string;
        render?: (row: CashAuditRecord) => ReactNode;
      }>,
    []
  );

  return (
    <VStack align="stretch" spacing={6}>
      <PageHeader
        title="Cash Audit"
        subtitle="Track denomination-based cash counts, staff cash taken, and variance against previous audit."
      />

      <AppCard>
        <SimpleGrid columns={{ base: 1, md: 2, xl: 5 }} spacing={4}>
          <AppInput
            label="Date From"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom((event.target as HTMLInputElement).value)}
          />
          <AppInput
            label="Date To"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo((event.target as HTMLInputElement).value)}
          />
          <AppInput
            label="Search"
            placeholder="Search by entered/approved user"
            value={search}
            onChange={(event) => setSearch((event.target as HTMLInputElement).value)}
          />
          <VStack align="stretch" spacing={1}>
            <Text fontWeight={600}>Rows per page</Text>
            <Select
              value={String(pagination.limit)}
              onChange={(event) => {
                handleLimitChange(Number(event.target.value) || 10);
              }}
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
            </Select>
          </VStack>
          <VStack align="stretch" justify="end">
            <Text opacity={0}>Refresh</Text>
            <AppButton onClick={handleRefresh} isLoading={loading}>
              Refresh
            </AppButton>
          </VStack>
        </SimpleGrid>
      </AppCard>

      <SimpleGrid columns={{ base: 1, md: 2, xl: 5 }} spacing={4}>
        <StatCard label="Total Audits" value={String(stats?.totalAudits ?? 0)} />
        <StatCard label="Total Counted" value={formatCurrency(stats?.totalCountedAmount ?? 0)} />
        <StatCard label="Staff Cash Taken" value={formatCurrency(stats?.totalStaffCashTaken ?? 0)} />
        <StatCard
          label="Latest vs Previous"
          value={formatCurrency(stats?.differenceFromLastAudit ?? 0)}
          helper={`Latest ${formatCurrency(stats?.latestCountedAmount ?? 0)} | Previous ${formatCurrency(stats?.previousCountedAmount ?? 0)}`}
        />
        <StatCard
          label="Last Audit"
          value={formatDateTime(stats?.latestAuditAt ?? null)}
          helper={`Average ${formatCurrency(stats?.averageCountedAmount ?? 0)}`}
        />
      </SimpleGrid>

      <AppCard title="Audit Records">
        {loading ? (
          <SkeletonTable />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={records.map((record) => ({ ...record, id: record.id }))}
              emptyState={
                <EmptyState
                  title="No cash audit records"
                  description="No entries found for the selected date range and filters."
                />
              }
            />
            <HStack justify="space-between" mt={4} flexWrap="wrap" gap={3}>
              <Text color="#705B52" fontSize="sm">
                Showing {records.length} of {pagination.total} records
              </Text>
              <HStack>
                <AppButton
                  variant="outline"
                  isDisabled={pagination.page <= 1}
                  onClick={() => handlePageChange(pagination.page - 1)}
                >
                  Previous
                </AppButton>
                <Text fontWeight={700}>
                  Page {pagination.page} of {pagination.totalPages}
                </Text>
                <AppButton
                  variant="outline"
                  isDisabled={pagination.page >= pagination.totalPages}
                  onClick={() => handlePageChange(pagination.page + 1)}
                >
                  Next
                </AppButton>
              </HStack>
            </HStack>
          </>
        )}
      </AppCard>
    </VStack>
  );
};
