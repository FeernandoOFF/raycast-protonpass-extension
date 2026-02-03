import { Item, ItemsJson, Vault, VaultsJson } from "./types";
import { promisify } from "util";
import { exec } from "child_process";
import { Cache } from "@raycast/api";


const execAsync = promisify(exec);

export type { Item, Vault };

export class Client {
  private cache = new Cache();
  private static VAULTS_CACHE_KEY = "vaults";
  private static ITEMS_CACHE_KEY = "items";

  constructor(private cliPath: string) {}

  // --- Cache ---

  private getCachedVaults(): Vault[] | null {
    const cachedVaults = this.cache.get(Client.VAULTS_CACHE_KEY);
    if (!cachedVaults) return null;
    return this.parseVaults(cachedVaults);
  }

  private async getCachedItems(vaultId: string): Promise<Item[] | null> {
    const cachedItems = this.cache.get(`${Client.ITEMS_CACHE_KEY}:${vaultId}`);
    if (!cachedItems) return null;
    return await this.parseItems(cachedItems);
  }

  private setCachedItems(rawJson: string, vaultId: string) {
    this.cache.set(`${Client.ITEMS_CACHE_KEY}:${vaultId}`, rawJson);
  }

  // -- CLI Operations

  private async getVaultName(vaultId: string): Promise<string | null> {
    const vaults = await this.getAllVaults();
    return vaults.find((v) => v.id === vaultId)?.title ?? null;
  }

  async getAllVaults(): Promise<Vault[]> {
    const cachedVaults = this.getCachedVaults();
    if (cachedVaults) return cachedVaults;

    const { stdout } = await execAsync(`${this.cliPath} vault list --output=json`);
    this.cache.set(Client.VAULTS_CACHE_KEY, stdout);
    return this.parseVaults(stdout);
  }

  async getItems(vaultName: string | null): Promise<Item[]> {
    if (vaultName) {
      const cachedItems = await this.getCachedItems(vaultName);
      if (cachedItems != null) return cachedItems;

      const { stdout} = await execAsync(`${this.cliPath} item list "${vaultName}" --output=json`);
      this.setCachedItems(stdout, vaultName);
      return this.parseItems(stdout);
    } else {
      const vaults = await this.getAllVaults();
      const fetchPromises = vaults.map(async (vault) => {
        const cachedItems = await this.getCachedItems(vault.id);
        if(cachedItems != null) return cachedItems

        const { stdout } = await execAsync(`${this.cliPath} item list "${vault.title}" --output=json`);
        this.setCachedItems(stdout, vault.id);
        return this.parseItems(stdout);
      });
      const results = await Promise.all(fetchPromises);
      return results.flat();
    }
  }

  // --- Parsers that also hydrate caches ---

  private parseVaults(rawJson: string): Vault[] {
    const parsed = JSON.parse(rawJson) as VaultsJson;
    const vaults = parsed.vaults.map((v) => ({ title: v.name, id: v.vault_id }));
    return vaults;
  }

  private async parseItems(rawJson: string): Promise<Item[]> {
    const parsed = JSON.parse(rawJson) as ItemsJson;
    const vaultName = await this.getVaultName(parsed.items[0].vault_id);

    const items: Item[] = parsed.items.map((it) => {
      return {
        id: it.id,
        title: it.content.title,
        vaultId: it.vault_id,
        urls: it.content.content.Login?.urls,
        vaultTitle: vaultName || undefined,
        email: it.content.content.Login?.email,
        password: it.content.content.Login?.password,
      };
    });
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