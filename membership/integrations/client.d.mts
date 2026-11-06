export interface UnionOffer { visible: boolean; purchasable: boolean; centerUrl?: string; variant?: 'A' | 'B' | null; version?: string; catalog?: { plans: Array<{ id: string; priceCents: number | null }>; products: Array<{ id: string; tierName: string }> } | null; }
export function createUnionClient(config: { origin?: string; token?: string; productId: string; fetcher?: typeof fetch }): {
  offer(centralUserId?: string | null, baselineStatus?: string): Promise<UnionOffer>;
  event(centralUserId: string, name: string, context?: Record<string, string>, id?: string, occurredAt?: number): Promise<unknown>;
  receipt(centralUserId: string, receipt: Record<string, unknown>): Promise<unknown>;
  productId: string;
};
