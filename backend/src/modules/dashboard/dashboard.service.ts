import { AppDataSource } from "../../database/data-source";
import { Invoice } from "../invoices/invoice.entity";
import { InvoiceLine } from "../invoices/invoice-line.entity";

type SalesStatsInput = {
  dateFrom?: string;
  dateTo?: string;
};

const toMoney = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number(Number.isFinite(parsed) ? parsed.toFixed(2) : 0);
};

const toDay = (value: Date) => value.toISOString().slice(0, 10);

const startOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
};

const buildDateSeries = (from: Date, to: Date) => {
  const rows: string[] = [];
  const cursor = startOfDay(from);
  const limit = startOfDay(to);
  while (cursor <= limit) {
    rows.push(toDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
};

export class DashboardService {
  private readonly invoiceRepository = AppDataSource.getRepository(Invoice);
  private readonly invoiceLineRepository = AppDataSource.getRepository(InvoiceLine);

  getAdminDashboard() {
    return {
      stats: [
        { label: "Total Revenue", value: "₹18,74,220", change: "+12.4%" },
        { label: "Active Staff", value: 27, change: "+2" },
        { label: "Open Bills", value: 41, change: "-5" },
        { label: "Low Stock Alerts", value: 8, change: "+1" }
      ],
      revenueTrend: [
        { month: "Jan", value: 124000 },
        { month: "Feb", value: 138000 },
        { month: "Mar", value: 151000 },
        { month: "Apr", value: 147000 },
        { month: "May", value: 166000 },
        { month: "Jun", value: 179000 }
      ],
      recentActivity: [
        { id: "1", action: "Staff login", actor: "counter_03", time: "2 mins ago" },
        { id: "2", action: "Offer published", actor: "manager_01", time: "14 mins ago" },
        { id: "3", action: "Stock adjusted", actor: "accounting", time: "36 mins ago" }
      ],
      quickActions: [
        { id: "1", label: "Create Offer" },
        { id: "2", label: "Add Item" },
        { id: "3", label: "Download Report" }
      ]
    };
  }

  getStaffDashboard(fullName: string) {
    return {
      welcomeTitle: `Welcome, ${fullName}`,
      summary: [
        { label: "Today's Bills", value: 24 },
        { label: "Open Tasks", value: 3 },
        { label: "Shift Status", value: "Active" }
      ],
      notes: [
        "Please confirm stock usage before shift close.",
        "New offer pricing is active from today."
      ]
    };
  }

  async getSalesStats(input: SalesStatsInput = {}) {
    const now = new Date();
    const toDate = input.dateTo ? endOfDay(new Date(input.dateTo)) : endOfDay(now);
    const fallbackFrom = new Date(toDate);
    fallbackFrom.setDate(fallbackFrom.getDate() - 6);
    const fromDate = input.dateFrom ? startOfDay(new Date(input.dateFrom)) : startOfDay(fallbackFrom);

    const safeFrom = Number.isNaN(fromDate.getTime()) ? startOfDay(fallbackFrom) : fromDate;
    const safeTo = Number.isNaN(toDate.getTime()) ? endOfDay(now) : toDate;

    const rangeDays = Math.max(1, Math.ceil((safeTo.getTime() - safeFrom.getTime()) / (24 * 60 * 60 * 1000)) + 1);
    const previousTo = new Date(safeFrom.getTime() - 1);
    const previousFrom = new Date(previousTo);
    previousFrom.setDate(previousFrom.getDate() - (rangeDays - 1));

    const paidInvoiceBase = this.invoiceRepository
      .createQueryBuilder("invoice")
      .where("invoice.status = 'paid'")
      .andWhere("invoice.createdAt >= :fromDate", { fromDate: safeFrom })
      .andWhere("invoice.createdAt <= :toDate", { toDate: safeTo });

    const previousPaidBase = this.invoiceRepository
      .createQueryBuilder("invoice")
      .where("invoice.status = 'paid'")
      .andWhere("invoice.createdAt >= :fromDate", { fromDate: previousFrom })
      .andWhere("invoice.createdAt <= :toDate", { toDate: previousTo });

    const [summary, previousSummary, paymentRows, orderTypeRows, trendRows, topCashierRows, topItemRows] =
      await Promise.all([
        paidInvoiceBase
          .clone()
          .select("COUNT(invoice.id)", "totalOrders")
          .addSelect("COALESCE(SUM(invoice.totalAmount), 0)", "totalSales")
          .addSelect("COALESCE(AVG(invoice.totalAmount), 0)", "avgOrderValue")
          .addSelect(
            "COALESCE(SUM(invoice.itemDiscountAmount + invoice.couponDiscountAmount + invoice.manualDiscountAmount), 0)",
            "discountAmount"
          )
          .addSelect("COALESCE(SUM(invoice.taxAmount), 0)", "taxAmount")
          .addSelect("COUNT(DISTINCT invoice.customerId)", "uniqueCustomers")
          .getRawOne<{
            totalOrders: string;
            totalSales: string;
            avgOrderValue: string;
            discountAmount: string;
            taxAmount: string;
            uniqueCustomers: string;
          }>(),
        previousPaidBase
          .clone()
          .select("COALESCE(SUM(invoice.totalAmount), 0)", "totalSales")
          .getRawOne<{ totalSales: string }>(),
        paidInvoiceBase
          .clone()
          .select("invoice.paymentMode", "paymentMode")
          .addSelect("COUNT(invoice.id)", "count")
          .addSelect("COALESCE(SUM(invoice.totalAmount), 0)", "amount")
          .groupBy("invoice.paymentMode")
          .orderBy("amount", "DESC")
          .getRawMany<{ paymentMode: string; count: string; amount: string }>(),
        paidInvoiceBase
          .clone()
          .select("invoice.orderType", "orderType")
          .addSelect("COUNT(invoice.id)", "count")
          .addSelect("COALESCE(SUM(invoice.totalAmount), 0)", "amount")
          .groupBy("invoice.orderType")
          .orderBy("amount", "DESC")
          .getRawMany<{ orderType: string; count: string; amount: string }>(),
        paidInvoiceBase
          .clone()
          .select("DATE(invoice.createdAt)", "date")
          .addSelect("COUNT(invoice.id)", "orders")
          .addSelect("COALESCE(SUM(invoice.totalAmount), 0)", "sales")
          .groupBy("DATE(invoice.createdAt)")
          .orderBy("DATE(invoice.createdAt)", "ASC")
          .getRawMany<{ date: string; orders: string; sales: string }>(),
        paidInvoiceBase
          .clone()
          .leftJoin("invoice.staff", "staff")
          .select("invoice.staffId", "staffId")
          .addSelect("COALESCE(staff.fullName, 'Unknown')", "staffName")
          .addSelect("COUNT(invoice.id)", "orderCount")
          .addSelect("COALESCE(SUM(invoice.totalAmount), 0)", "totalSales")
          .groupBy("invoice.staffId")
          .addGroupBy("staff.fullName")
          .orderBy("COALESCE(SUM(invoice.totalAmount), 0)", "DESC")
          .addOrderBy("COUNT(invoice.id)", "DESC")
          .take(5)
          .getRawMany<{
            staffId: string;
            staffName: string;
            orderCount: string;
            totalSales: string;
          }>(),
        this.invoiceLineRepository
          .createQueryBuilder("line")
          .leftJoin(Invoice, "invoice", "invoice.id = line.invoiceId")
          .where("invoice.status = 'paid'")
          .andWhere("invoice.createdAt >= :fromDate", { fromDate: safeFrom })
          .andWhere("invoice.createdAt <= :toDate", { toDate: safeTo })
          .select("line.nameSnapshot", "name")
          .addSelect("line.lineType", "lineType")
          .addSelect("COALESCE(SUM(line.quantity), 0)", "quantity")
          .addSelect("COALESCE(SUM(line.lineTotal), 0)", "total")
          .groupBy("line.nameSnapshot")
          .addGroupBy("line.lineType")
          .orderBy("total", "DESC")
          .take(8)
          .getRawMany<{
            name: string;
            lineType: string;
            quantity: string;
            total: string;
          }>()
      ]);

    const totalSales = toMoney(summary?.totalSales ?? 0);
    const previousSales = toMoney(previousSummary?.totalSales ?? 0);
    const salesGrowthPercentage =
      previousSales > 0 ? Number((((totalSales - previousSales) / previousSales) * 100).toFixed(2)) : null;

    const trendMap = new Map(
      trendRows.map((row) => [
        row.date,
        {
          orders: Number(row.orders ?? 0),
          sales: toMoney(row.sales ?? 0)
        }
      ])
    );
    const trend = buildDateSeries(safeFrom, safeTo).map((date) => ({
      date,
      orders: trendMap.get(date)?.orders ?? 0,
      sales: trendMap.get(date)?.sales ?? 0
    }));

    return {
      range: {
        from: toDay(safeFrom),
        to: toDay(safeTo),
        days: rangeDays
      },
      cards: {
        totalSales,
        totalOrders: Number(summary?.totalOrders ?? 0),
        averageOrderValue: toMoney(summary?.avgOrderValue ?? 0),
        totalDiscount: toMoney(summary?.discountAmount ?? 0),
        totalTax: toMoney(summary?.taxAmount ?? 0),
        uniqueCustomers: Number(summary?.uniqueCustomers ?? 0),
        previousPeriodSales: previousSales,
        salesGrowthPercentage
      },
      paymentModeBreakdown: paymentRows.map((row) => ({
        paymentMode: row.paymentMode,
        count: Number(row.count ?? 0),
        amount: toMoney(row.amount ?? 0)
      })),
      orderTypeBreakdown: orderTypeRows.map((row) => ({
        orderType: row.orderType,
        count: Number(row.count ?? 0),
        amount: toMoney(row.amount ?? 0)
      })),
      trend,
      topCashiers: topCashierRows.map((row) => ({
        staffId: row.staffId,
        staffName: row.staffName,
        orderCount: Number(row.orderCount ?? 0),
        totalSales: toMoney(row.totalSales ?? 0)
      })),
      topSellingLines: topItemRows.map((row) => ({
        name: row.name,
        lineType: row.lineType,
        quantity: Number(Number(row.quantity ?? 0).toFixed(2)),
        total: toMoney(row.total ?? 0)
      }))
    };
  }
}
