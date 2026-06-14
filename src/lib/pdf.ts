/**
 * PDF generation for quotes and invoices using PDFKit.
 * Returns a Buffer so it can be uploaded to WhatsApp Cloud API.
 */

import PDFDocument from 'pdfkit';
import { LineItem } from './lineItemParser';

export interface InvoicePdfOptions {
  docType: 'quote' | 'invoice';
  invoiceNumber: string;
  businessName: string;
  customerName: string;
  items: LineItem[];
  total: number;
  dueDate: string | null;
}

export async function generateInvoicePdf(opts: InvoicePdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const primaryColor = '#1a1a2e';
    const accentColor = '#e94560';
    const grayColor = '#6b7280';

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill(primaryColor);

    // Business name
    doc
      .fillColor('#ffffff')
      .fontSize(22)
      .font('Helvetica-Bold')
      .text(opts.businessName, 50, 25, { width: 300 });

    // Document type badge
    const badgeText = opts.docType === 'quote' ? 'QUOTE' : 'INVOICE';
    doc
      .fillColor(accentColor)
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(badgeText, 0, 30, { align: 'right', width: doc.page.width - 50 });

    doc.moveDown(3);

    // Invoice number and date
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    doc
      .fillColor(primaryColor)
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(`${opts.docType === 'quote' ? 'Quote' : 'Invoice'} Number:`, 50, 110)
      .font('Helvetica')
      .text(opts.invoiceNumber, 200, 110)
      .font('Helvetica-Bold')
      .text('Date:', 50, 130)
      .font('Helvetica')
      .text(dateStr, 200, 130);

    if (opts.dueDate) {
      const due = new Date(opts.dueDate).toLocaleDateString('en-ZA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      doc
        .font('Helvetica-Bold')
        .text('Due Date:', 50, 150)
        .font('Helvetica')
        .text(due, 200, 150);
    }

    // Bill to
    const billToY = opts.dueDate ? 185 : 165;
    doc
      .fillColor(grayColor)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('BILL TO', 50, billToY)
      .fillColor(primaryColor)
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(opts.customerName, 50, billToY + 14);

    // Line items table
    const tableTop = billToY + 60;
    const tableLeft = 50;
    const colWidths = [280, 80, 80, 80];

    // Table header
    doc
      .rect(tableLeft, tableTop, doc.page.width - 100, 28)
      .fill(primaryColor);

    const headerY = tableTop + 8;
    doc
      .fillColor('#ffffff')
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Description', tableLeft + 8, headerY)
      .text('Qty', tableLeft + colWidths[0] + 8, headerY)
      .text('Unit Price', tableLeft + colWidths[0] + colWidths[1] + 8, headerY)
      .text('Amount', tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 8, headerY);

    // Table rows
    let rowY = tableTop + 32;
    opts.items.forEach((item, idx) => {
      if (idx % 2 === 1) {
        doc
          .rect(tableLeft, rowY - 4, doc.page.width - 100, 26)
          .fill('#f9fafb');
      }

      doc
        .fillColor(primaryColor)
        .fontSize(10)
        .font('Helvetica')
        .text(item.description, tableLeft + 8, rowY, { width: colWidths[0] - 16 })
        .text(String(item.quantity ?? 1), tableLeft + colWidths[0] + 8, rowY)
        .text(`R${(item.unitPrice ?? item.amount).toFixed(2)}`, tableLeft + colWidths[0] + colWidths[1] + 8, rowY)
        .text(`R${item.amount.toFixed(2)}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + 8, rowY);

      rowY += 26;
    });

    // Total line
    const totalY = rowY + 10;
    doc
      .moveTo(tableLeft, totalY)
      .lineTo(doc.page.width - 50, totalY)
      .strokeColor(primaryColor)
      .lineWidth(1)
      .stroke();

    doc
      .fillColor(primaryColor)
      .fontSize(13)
      .font('Helvetica-Bold')
      .text('TOTAL', tableLeft + colWidths[0] + colWidths[1], totalY + 8)
      .fillColor(accentColor)
      .text(`R${opts.total.toFixed(2)}`, tableLeft + colWidths[0] + colWidths[1] + colWidths[2], totalY + 8);

    // Footer
    doc
      .fillColor(grayColor)
      .fontSize(9)
      .font('Helvetica')
      .text(
        'Powered by BizBot SA • bizbot.co.za',
        50,
        doc.page.height - 60,
        { align: 'center', width: doc.page.width - 100 }
      );

    if (opts.docType === 'invoice') {
      doc
        .fillColor(grayColor)
        .fontSize(9)
        .text(
          'Thank you for your business! Payment is due within 14 days.',
          50,
          doc.page.height - 45,
          { align: 'center', width: doc.page.width - 100 }
        );
    }

    doc.end();
  });
}
