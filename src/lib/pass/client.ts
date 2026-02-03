import { Item, ItemsJson, Vault, VaultsJson } from "./types";
import { promisify } from "util";
import { exec } from "child_process";
import { Cache, getPreferenceValues } from "@raycast/api";
import { useMemo } from "react";

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

  private setCachedVaults(rawJson: string) {
    this.cache.set(Client.VAULTS_CACHE_KEY, rawJson);
  }

  private async getCachedItems(vaultName: string): Promise<Item[] | null> {
    const cachedItems = this.cache.get(`${Client.ITEMS_CACHE_KEY}:${vaultName}`);
    if (!cachedItems) return null;
    return await this.parseItems(cachedItems);
  }

  private setCachedItems(rawJson: string, vaultName: string) {
    this.cache.set(`${Client.ITEMS_CACHE_KEY}:${vaultName}`, rawJson);
  }

  // -- CLI Operations

  private async getVaultName(vaultId: string): Promise<string | null> {
    const vaults = await this.getAllVaults();
    return vaults.find((v) => v.id === vaultId)?.title ?? null;
  }

  async getAllVaults(): Promise<Vault[]> {
    const fetchAndRefreshVaults = async () => {
      const { stdout, stderr } = await execAsync(`${this.cliPath} vault list --output=json`);
      if (stderr) throw new Error(`Error fetching vaults: ${stderr}`);
      this.setCachedVaults(stdout);
      return stdout;
    };

    const cachedVaults = this.getCachedVaults();
    if (cachedVaults) {
      fetchAndRefreshVaults(); //Refresh cache in the background
      return cachedVaults;
    }

    const vaultsJson = await fetchAndRefreshVaults();
    return this.parseVaults(vaultsJson);
  }

  async getItems(vaultName: string | null): Promise<Item[]> {
    const fetchAndRefreshItems = async (vaultName: string) => {
      const { stdout, stderr } = await execAsync(`${this.cliPath} item list "${vaultName}" --output=json`);
      if (stderr) throw new Error(`Error fetching items: ${stderr}`);
      this.setCachedItems(stdout, vaultName);
      return stdout;
    };

    if (vaultName) {
      const cachedItems = await this.getCachedItems(vaultName);
      if (cachedItems != null) {
        fetchAndRefreshItems(vaultName); // Refresh cache in the background
        return cachedItems;
      }
      const itemsJson = await fetchAndRefreshItems(vaultName);
      return this.parseItems(itemsJson);
    } else {
      const vaults = await this.getAllVaults();
      const fetchPromises = vaults.map(async (vault) => {
        const cachedItems = await this.getCachedItems(vault.title);
        if (cachedItems != null) {
          fetchAndRefreshItems(vault.title);
          return cachedItems;
        }

        const itemsJson = await fetchAndRefreshItems(vault.title);
        return this.parseItems(itemsJson);
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

    const items: Item[] = parsed.items
      .map((it) => {
      return {
        id: it.id,
        title: it.content.title,
        vaultId: it.vault_id,
        urls: it.content.content.Login?.urls,
        state: it.state,
        vaultTitle: vaultName || undefined,
        email: it.content.content.Login?.email,
        password: it.content.content.Login?.password,
      };
    });
    return items;
  }
}

const { cliPath } = getPreferenceValues<Preferences>();
// Single in-memory client
let client: Client | null = null;

function getPassClient() {
  if (!client) {
    client = new Client(cliPath);
  }
  return client;
}

export function useClient() {
  return useMemo(() => getPassClient(), []);
}
