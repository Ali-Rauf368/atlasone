import { prisma } from "./db.js";
export async function toUsd(amount: number, currency: string): Promise<number> {
  if (currency === "USD") return amount;
  const r = await prisma.fxRate.findUnique({ where: { currency } });
  if (!r) throw new Error(`No FX rate for ${currency}`);
  return Math.round(amount * Number(r.toUsd) * 100) / 100;
}
