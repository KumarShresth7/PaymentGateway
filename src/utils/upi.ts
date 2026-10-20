import QRCode from "qrcode";

export interface UPISpec {
  vpa: string;
  name: string;
  amount: number;
  note?: string;
  transactionNote?: string;
}

export function buildUpiUri(spec: UPISpec): string {
  const params = new URLSearchParams({
    pa: spec.vpa,
    pn: spec.name,
    am: spec.amount.toFixed(2),
    cu: "INR",
    tn: spec.transactionNote || spec.note || "Order Payment",
  });
  return `upi://pay?${params.toString()}`;
}

export async function generateQrSvg(upiUri: string): Promise<string> {
  return QRCode.toString(upiUri, {
    type: 'svg',
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}


