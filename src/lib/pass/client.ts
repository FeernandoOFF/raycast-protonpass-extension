import { Item, ItemsJson, Vault, VaultsJson } from "./types";

export type { Item, Vault };

export class Client {
  private vaultsCache: Vault[] | null = null;
  private itemsByVaultCache = new Map<string, Item[]>();

  constructor(private cliPath: string) {}

  // --- Query builders ---

  buildListVaultsCommand() {
    return {
      command: this.cliPath,
      args: ["vault", "list", "--output=json"],
    };
  }

  buildListItemsCommand(vaultName: string) {
    return {
      command: this.cliPath,
      args: ["item", "list", vaultName, "--output=json"],
    };
  }

  // --- Cache getters ---

  getCachedVaults(): Vault[] | null {
    return this.vaultsCache;
  }

  getCachedItems(vaultId: string): Item[] | null {
    return this.itemsByVaultCache.get(vaultId) ?? null;
  }

  // -- CRUD Operations



  // --- Parsers that also hydrate caches ---

  setVaultsFromJson(rawJson: string): Vault[] {
    const parsed = JSON.parse(rawJson) as VaultsJson;
    const vaults = parsed.vaults.map((v) => ({ title: v.name, id: v.vault_id }));
    this.vaultsCache = vaults;
    return vaults;
  }

  setItems(vaultName: string, items: Item[]): Item[] {
    this.itemsByVaultCache.set(vaultName, items);
    return items;
  }

  setItemsFromJson(vaultName: string, rawJson: string): Item[] {
    const parsed = JSON.parse(rawJson) as ItemsJson;
    const items: Item[] = parsed.items.map((it) => {
      return {
        id: it.id,
        title: it.content.title,
        vaultId: it.vault_id,
        urls: it.content.content.Login?.urls,
        vaultTitle: vaultName,
        email: it.content.content.Login?.email,
        password: it.content.content.Login?.password,
      };
    });

    this.itemsByVaultCache.set(vaultName, items);
    return items;
  }
}

// Single in-memory client
let client: Client | null = null;

export function getPassClient(cliPath: string) {
  if (!client) {
    client = new Client(cliPath);
  }
  return client;
}