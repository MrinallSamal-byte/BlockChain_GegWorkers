import { provider, validatorWallet, log } from "../config.js";

let currentNonce: number | null = null;
let initPromise: Promise<void> | null = null;
let queue: Promise<number> = Promise.resolve(0);

async function init(): Promise<void> {
  currentNonce = await provider.getTransactionCount(validatorWallet.address, "pending");
  log.info({ nonce: currentNonce, wallet: validatorWallet.address }, "NonceManager initialized");
}

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export const nonceManager = {
  async getAndIncrement(): Promise<number> {
    await ensureInit();
    const result = new Promise<number>((resolve, reject) => {
      queue = queue.then(async () => {
        if (currentNonce === null) {
          currentNonce = await provider.getTransactionCount(validatorWallet.address, "pending");
        }
        const nonce = currentNonce;
        currentNonce += 1;
        resolve(nonce);
        return nonce;
      }).catch((err) => {
        reject(err);
        return 0;
      });
    });
    return result;
  },

  async reset(): Promise<void> {
    currentNonce = await provider.getTransactionCount(validatorWallet.address, "pending");
    log.warn({ nonce: currentNonce }, "NonceManager reset to on-chain pending count");
  }
};
