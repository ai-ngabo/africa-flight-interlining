export interface Money {
  /** Amount in the traveller's currency (or USD). */
  main: string;
  /** USD reference shown underneath when the main currency is not USD. */
  alt: string;
}
export type MoneyFn = (usd: number) => Money;
export const inline = (m: Money) => (m.alt ? `${m.main} (${m.alt})` : m.main);
