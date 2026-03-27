type ExportColumn = {
  key: string;
  label: string;
};

type ExportStat = {
  label: string;
  value: string | number;
  hint?: string;
};

type ExportRow = Record<string, string | number | null>;

type StockConsumptionExportPayload = {
  title: string;
  outletLabel: string;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  columns: ExportColumn[];
  rows: ExportRow[];
  stats: ExportStat[];
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeXml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const formatCell = (value: string | number | null) => (value === null || value === undefined ? "-" : String(value));

const toPdfSafeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const wrapLine = (line: string, maxLength: number) => {
  if (line.length <= maxLength) {
    return [line];
  }

  const words = line.split(/\s+/g).filter(Boolean);
  if (!words.length) {
    return [line.slice(0, maxLength)];
  }

  const lines: string[] = [];
  let bucket = "";

  words.forEach((word) => {
    if (!bucket.length) {
      bucket = word;
      return;
    }
    if (bucket.length + 1 + word.length <= maxLength) {
      bucket += ` ${word}`;
      return;
    }
    lines.push(bucket);
    bucket = word;
  });

  if (bucket.length) {
    lines.push(bucket);
  }

  return lines.length ? lines : [line.slice(0, maxLength)];
};

const toPdfBuffer = (pages: string[][]) => {
  if (!pages.length) {
    pages = [["No data"]];
  }

  const objectCount = 3 + pages.length * 2;
  const fontObjectId = objectCount;
  const objects = new Map<number, string>();

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectIds = pages.map((_page, index) => 3 + index * 2);
  objects.set(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`
  );

  pages.forEach((pageLines, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const contentLines = [
      "BT",
      "/F1 9 Tf",
      "13 TL",
      "36 804 Td"
    ];

    pageLines.forEach((line, lineIndex) => {
      const safe = toPdfSafeText(line);
      if (lineIndex === 0) {
        contentLines.push(`(${safe}) Tj`);
      } else {
        contentLines.push(`T* (${safe}) Tj`);
      }
    });

    contentLines.push("ET");
    const content = contentLines.join("\n");

    objects.set(
      pageObjectId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`
    );
    objects.set(contentObjectId, `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  });

  objects.set(fontObjectId, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  const orderedIds = Array.from({ length: objectCount }, (_value, index) => index + 1);
  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];

  orderedIds.forEach((id) => {
    offsets[id] = Buffer.byteLength(output, "utf8");
    output += `${id} 0 obj\n${objects.get(id) ?? ""}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objectCount + 1}\n`;
  output += "0000000000 65535 f \n";

  orderedIds.forEach((id) => {
    output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  });

  output += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "utf8");
};

export const buildStockConsumptionHtmlDocument = (payload: StockConsumptionExportPayload) => {
  const statCards = payload.stats
    .map(
      (stat) => `
        <div class="stat-card">
          <div class="stat-label">${escapeHtml(stat.label)}</div>
          <div class="stat-value">${escapeHtml(stat.value)}</div>
          ${stat.hint ? `<div class="stat-hint">${escapeHtml(stat.hint)}</div>` : ""}
        </div>
      `
    )
    .join("");

  const headerCells = payload.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const bodyRows = payload.rows
    .map(
      (row) => `
      <tr>
        ${payload.columns.map((column) => `<td>${escapeHtml(formatCell(row[column.key] ?? null))}</td>`).join("")}
      </tr>
    `
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(payload.title)}</title>
    <style>
      body {
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        margin: 24px;
        color: #2d201b;
        background: #f8f6f2;
      }
      .brand {
        border: 1px solid #dbc6af;
        border-radius: 12px;
        background: #fffdf9;
        padding: 16px;
        margin-bottom: 16px;
      }
      .brand h1 {
        margin: 0;
        font-size: 24px;
      }
      .brand p {
        margin: 6px 0 0;
        color: #6d5b4f;
        font-size: 14px;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }
      .stat-card {
        border: 1px solid #dbc6af;
        border-radius: 10px;
        background: #fffaf2;
        padding: 10px 12px;
      }
      .stat-label {
        color: #7c6658;
        font-size: 12px;
      }
      .stat-value {
        font-size: 22px;
        font-weight: 700;
        margin-top: 4px;
      }
      .stat-hint {
        color: #8f7a6b;
        font-size: 12px;
        margin-top: 2px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        background: #fff;
        border: 1px solid #dbc6af;
      }
      th, td {
        border-bottom: 1px solid #ecdcc9;
        padding: 8px 10px;
        text-align: left;
        font-size: 12px;
      }
      th {
        background: #f3e8d8;
        font-weight: 700;
      }
      .meta {
        margin: 8px 0 16px;
        color: #6d5b4f;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <section class="brand">
      <h1>Dip & Dash - Stock Consumption Report</h1>
      <p>Outlet: ${escapeHtml(payload.outletLabel)}</p>
      <p>Date Range: ${escapeHtml(payload.dateFrom)} to ${escapeHtml(payload.dateTo)}</p>
      <p>Generated At: ${escapeHtml(payload.generatedAt)}</p>
    </section>
    <section class="stats">
      ${statCards || "<div class=\"stat-card\"><div class=\"stat-label\">Rows</div><div class=\"stat-value\">0</div></div>"}
    </section>
    <section>
      <table>
        <thead>
          <tr>${headerCells}</tr>
        </thead>
        <tbody>
          ${bodyRows || `<tr><td colspan="${payload.columns.length}">No rows available in the selected range.</td></tr>`}
        </tbody>
      </table>
    </section>
  </body>
</html>`;
};

export const buildStockConsumptionExcelXml = (payload: StockConsumptionExportPayload) => {
  const headerRow = payload.columns
    .map(
      (column) =>
        `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeXml(column.label)}</Data></Cell>`
    )
    .join("");

  const bodyRows = payload.rows
    .map((row) => {
      const cells = payload.columns
        .map((column) => {
          const value = row[column.key] ?? null;
          if (typeof value === "number") {
            return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
          }
          return `<Cell><Data ss:Type="String">${escapeXml(formatCell(value))}</Data></Cell>`;
        })
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  const statRows = payload.stats
    .map(
      (stat) => `
      <Row>
        <Cell ss:StyleID="meta"><Data ss:Type="String">${escapeXml(stat.label)}</Data></Cell>
        <Cell><Data ss:Type="${typeof stat.value === "number" ? "Number" : "String"}">${escapeXml(stat.value)}</Data></Cell>
      </Row>
    `
    )
    .join("");

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="title">
      <Font ss:Bold="1" ss:Size="14"/>
    </Style>
    <Style ss:ID="meta">
      <Font ss:Bold="1"/>
    </Style>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#EFE1CD" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Stock Consumption">
    <Table>
      <Row><Cell ss:StyleID="title"><Data ss:Type="String">Dip &amp; Dash - Stock Consumption Report</Data></Cell></Row>
      <Row><Cell ss:StyleID="meta"><Data ss:Type="String">Outlet</Data></Cell><Cell><Data ss:Type="String">${escapeXml(payload.outletLabel)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="meta"><Data ss:Type="String">Date Range</Data></Cell><Cell><Data ss:Type="String">${escapeXml(payload.dateFrom)} to ${escapeXml(payload.dateTo)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="meta"><Data ss:Type="String">Generated At</Data></Cell><Cell><Data ss:Type="String">${escapeXml(payload.generatedAt)}</Data></Cell></Row>
      <Row></Row>
      ${statRows}
      <Row></Row>
      <Row>${headerRow}</Row>
      ${bodyRows || `<Row><Cell><Data ss:Type="String">No rows available in the selected range.</Data></Cell></Row>`}
    </Table>
  </Worksheet>
</Workbook>`;

  return Buffer.from(xml, "utf8");
};

export const buildStockConsumptionPdf = (payload: StockConsumptionExportPayload) => {
  const lines: string[] = [];
  lines.push("Dip & Dash - Stock Consumption Report");
  lines.push(`Outlet: ${payload.outletLabel}`);
  lines.push(`Date Range: ${payload.dateFrom} to ${payload.dateTo}`);
  lines.push(`Generated At: ${payload.generatedAt}`);
  lines.push("");

  payload.stats.forEach((stat) => {
    lines.push(`${stat.label}: ${stat.value}${stat.hint ? ` (${stat.hint})` : ""}`);
  });

  lines.push("");
  lines.push(payload.columns.map((column) => column.label).join(" | "));
  lines.push("-".repeat(180));

  payload.rows.forEach((row) => {
    const rowLine = payload.columns.map((column) => formatCell(row[column.key] ?? null)).join(" | ");
    wrapLine(rowLine, 150).forEach((part) => lines.push(part));
  });

  if (!payload.rows.length) {
    lines.push("No rows available in the selected range.");
  }

  const maxLinesPerPage = 56;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pages.push(lines.slice(index, index + maxLinesPerPage));
  }

  return toPdfBuffer(pages);
};

export type { StockConsumptionExportPayload };
