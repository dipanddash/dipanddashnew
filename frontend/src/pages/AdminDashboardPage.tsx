import { Alert, AlertIcon, Box, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { AppCard } from "@/components/ui/AppCard";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/common/PageHeader";
import { ErrorFallback } from "@/components/feedback/ErrorFallback";
import { SkeletonCard } from "@/components/feedback/SkeletonCard";
import { SkeletonWidget } from "@/components/feedback/SkeletonWidget";
import { useAdminDashboard } from "@/features/dashboard/hooks/useAdminDashboard";
import { RevenueChart } from "@/features/dashboard/components/RevenueChart";
import { RecentActivityList } from "@/features/dashboard/components/RecentActivityList";
import { QuickActions } from "@/features/dashboard/components/QuickActions";
import { attendanceService } from "@/services/attendance.service";
import type { AttendanceSummary } from "@/types/attendance";

const getTodayString = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const emptyAttendanceSummary: AttendanceSummary = {
  totalRecords: 0,
  presentStaff: 0,
  currentlyPunchedIn: 0,
  activeHours: 0,
  breakHours: 0,
  totalHours: 0
};

export const AdminDashboardPage = () => {
  const { data, loading, error, refetch } = useAdminDashboard();
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary>(emptyAttendanceSummary);
  const [attendanceLoading, setAttendanceLoading] = useState(true);

  const statCards = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.stats;
  }, [data]);

  useEffect(() => {
    let cancelled = false;

    const fetchAttendanceSummary = async () => {
      setAttendanceLoading(true);
      try {
        const response = await attendanceService.getAdminRecords({
          date: getTodayString(),
          page: 1,
          limit: 5
        });
        if (!cancelled) {
          setAttendanceSummary(response.data.summary);
        }
      } catch {
        if (!cancelled) {
          setAttendanceSummary(emptyAttendanceSummary);
        }
      } finally {
        if (!cancelled) {
          setAttendanceLoading(false);
        }
      }
    };

    void fetchAttendanceSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <ErrorFallback title="Unable to Load Admin Dashboard" message={error} onRetry={() => void refetch()} />;
  }

  return (
    <VStack spacing={6} align="stretch">
      <PageHeader
        title="Admin Dashboard"
        subtitle="Track revenue, performance and real-time business activities."
      />

      <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} spacing={4}>
        {loading
          ? Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)
          : statCards.map((stat) => (
              <StatCard key={stat.label} label={stat.label} value={stat.value} change={stat.change} />
            ))}
      </SimpleGrid>

      <AppCard
        title="Today's Attendance Pulse"
        subtitle="Daily shift health snapshot with real-time attendance state."
      >
        <SimpleGrid columns={{ base: 2, lg: 4 }} spacing={4}>
          <Box
            p={4}
            borderRadius="14px"
            border="1px solid"
            borderColor="rgba(142, 9, 9, 0.18)"
            bg="linear-gradient(110deg, rgba(142, 9, 9, 0.08) 0%, rgba(209, 161, 61, 0.16) 100%)"
          >
            <Text color="#6A5049" fontWeight={700} fontSize="sm">
              Staff Present
            </Text>
            <Text mt={2} fontSize="2xl" fontWeight={800} color="#2A1914">
              {attendanceLoading ? "-" : attendanceSummary.presentStaff}
            </Text>
          </Box>
          <Box
            p={4}
            borderRadius="14px"
            border="1px solid"
            borderColor="rgba(142, 9, 9, 0.18)"
            bg="linear-gradient(110deg, rgba(142, 9, 9, 0.08) 0%, rgba(209, 161, 61, 0.16) 100%)"
          >
            <Text color="#6A5049" fontWeight={700} fontSize="sm">
              Live Punched In
            </Text>
            <Text mt={2} fontSize="2xl" fontWeight={800} color="#2A1914">
              {attendanceLoading ? "-" : attendanceSummary.currentlyPunchedIn}
            </Text>
          </Box>
          <Box
            p={4}
            borderRadius="14px"
            border="1px solid"
            borderColor="rgba(142, 9, 9, 0.18)"
            bg="linear-gradient(110deg, rgba(142, 9, 9, 0.08) 0%, rgba(209, 161, 61, 0.16) 100%)"
          >
            <Text color="#6A5049" fontWeight={700} fontSize="sm">
              Active Hours
            </Text>
            <Text mt={2} fontSize="2xl" fontWeight={800} color="#2A1914">
              {attendanceLoading ? "-" : `${attendanceSummary.activeHours}h`}
            </Text>
          </Box>
          <Box
            p={4}
            borderRadius="14px"
            border="1px solid"
            borderColor="rgba(142, 9, 9, 0.18)"
            bg="linear-gradient(110deg, rgba(142, 9, 9, 0.08) 0%, rgba(209, 161, 61, 0.16) 100%)"
          >
            <Text color="#6A5049" fontWeight={700} fontSize="sm">
              Total Records
            </Text>
            <Text mt={2} fontSize="2xl" fontWeight={800} color="#2A1914">
              {attendanceLoading ? "-" : attendanceSummary.totalRecords}
            </Text>
          </Box>
        </SimpleGrid>
      </AppCard>

      <SimpleGrid columns={{ base: 1, xl: 3 }} spacing={4}>
        <Box gridColumn={{ base: "auto", xl: "span 2" }}>
          {loading ? (
            <SkeletonWidget />
          ) : (
            <AppCard title="Revenue Trend" subtitle="Mock analytics structured for future API data">
              <RevenueChart data={data?.revenueTrend ?? []} />
            </AppCard>
          )}
        </Box>
        {loading ? (
          <SkeletonWidget />
        ) : (
          <AppCard title="Quick Actions">
            <QuickActions actions={data?.quickActions ?? []} />
          </AppCard>
        )}
      </SimpleGrid>

      {loading ? (
        <SkeletonWidget />
      ) : (
        <AppCard title="Recent Activity">
          <RecentActivityList activities={data?.recentActivity ?? []} />
        </AppCard>
      )}

      <Alert
        borderRadius="14px"
        status="info"
        bg="linear-gradient(90deg, #FFF5E2 0%, #FFEBC9 100%)"
        border="1px solid"
        borderColor="rgba(195, 146, 53, 0.38)"
        color="#5B473D"
      >
        <AlertIcon />
        Dashboard is powered by mock datasets and is API-ready for real billing analytics integration.
      </Alert>
    </VStack>
  );
};
