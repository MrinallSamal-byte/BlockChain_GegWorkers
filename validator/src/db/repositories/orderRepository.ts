import type { OrderRecord } from "../../config.js";
import { orders, orderKey } from "../../config.js";

let pgPool: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> } | null = null;

async function getPool() {
  if (pgPool) return pgPool;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  try {
    const { default: pg } = await import("pg");
    pgPool = new pg.Pool({ connectionString: dbUrl });
    return pgPool;
  } catch {
    return null;
  }
}

function rowToRecord(row: Record<string, unknown>): OrderRecord {
  return {
    companyId: row.company_id as string,
    orderId: row.order_id as string,
    orderIdHash: row.order_id_hash as string,
    riderId: row.rider_id as string,
    riderDid: row.rider_did as string,
    riderDidHash: row.rider_did_hash as string,
    targetLatE7: row.target_lat_e7 as number,
    targetLonE7: row.target_lon_e7 as number,
    radiusMeters: row.radius_meters as number,
    webhookUrl: row.webhook_url as string | undefined,
    createdAtEpoch: Math.floor(new Date(row.created_at as string).getTime() / 1000),
    status: row.status as OrderRecord["status"],
    proofId: row.proof_id as string | undefined,
    txHash: row.tx_hash as string | undefined
  };
}

export const orderRepository = {
  async create(order: Omit<OrderRecord, "proofId" | "txHash">): Promise<OrderRecord> {
    const pool = await getPool();
    if (!pool) {
      const key = orderKey(order.companyId, order.orderId);
      orders.set(key, order as OrderRecord);
      return order as OrderRecord;
    }
    const { rows } = await pool.query(
      `INSERT INTO orders
         (company_id, order_id, order_id_hash, rider_id, rider_did, rider_did_hash,
          target_lat_e7, target_lon_e7, radius_meters, webhook_url, created_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
       RETURNING *`,
      [
        order.companyId, order.orderId, order.orderIdHash,
        order.riderId, order.riderDid, order.riderDidHash,
        order.targetLatE7, order.targetLonE7, order.radiusMeters,
        order.webhookUrl ?? null, order.status
      ]
    );
    return rowToRecord(rows[0] as Record<string, unknown>);
  },

  async findByKey(companyId: string, orderId: string): Promise<OrderRecord | null> {
    const pool = await getPool();
    if (!pool) return orders.get(orderKey(companyId, orderId)) ?? null;
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE company_id = $1 AND order_id = $2 LIMIT 1",
      [companyId, orderId]
    );
    if (!rows.length) return null;
    return rowToRecord(rows[0] as Record<string, unknown>);
  },

  async findByOrderIdHash(orderIdHash: string): Promise<OrderRecord | null> {
    const pool = await getPool();
    if (!pool) {
      return [...orders.values()].find((o) => o.orderIdHash === orderIdHash) ?? null;
    }
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE order_id_hash = $1 LIMIT 1",
      [orderIdHash]
    );
    if (!rows.length) return null;
    return rowToRecord(rows[0] as Record<string, unknown>);
  },

  async findByOrderIdAndRiderDid(orderId: string, riderDid: string): Promise<OrderRecord | null> {
    const pool = await getPool();
    if (!pool) {
      const matches = [...orders.values()].filter((o) => o.orderId === orderId && o.riderDid === riderDid);
      return matches.length === 1 ? matches[0] : null;
    }
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE order_id = $1 AND rider_did = $2 LIMIT 2",
      [orderId, riderDid]
    );
    if (rows.length !== 1) return null;
    return rowToRecord(rows[0] as Record<string, unknown>);
  },

  async updateStatus(
    orderIdHash: string,
    status: OrderRecord["status"],
    proofId?: string,
    txHash?: string
  ): Promise<void> {
    const pool = await getPool();
    if (!pool) {
      const record = [...orders.values()].find((o) => o.orderIdHash === orderIdHash);
      if (record) {
        record.status = status;
        if (proofId) record.proofId = proofId;
        if (txHash) record.txHash = txHash;
        orders.set(orderKey(record.companyId, record.orderId), record);
      }
      return;
    }
    await pool.query(
      `UPDATE orders
       SET status = $1, proof_id = COALESCE($2, proof_id), tx_hash = COALESCE($3, tx_hash)
       WHERE order_id_hash = $4`,
      [status, proofId ?? null, txHash ?? null, orderIdHash]
    );
  }
};
