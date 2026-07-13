import {
  Item,
  ItemField,
  ItemFieldJson,
  ItemListJson,
  ItemSection,
  ItemSectionJson,
  ItemSummary,
  ItemType,
  ItemTotpJson,
  ItemViewJson,
  VaultItemJson,
  PassCliError,
  Vault,
  VaultsJson,
} from "./types";
import { promisify } from "util";
import { execFile, spawn } from "child_process";
import { Cache, getPreferenceValues, open, showToast, Toast } from "@raycast/api";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB
const LOGIN_URL_PATTERN = /https?:\/\/[^\s"'<>]+/i;
const LOGIN_FAILURE_MESSAGE =
  "Raycast couldn't complete Proton Pass login. Try again to reopen the login URL, or run 'pass-cli login' manually.";

const execFileAsync = promisify(execFile);

export type { Item, Vault };

type ExecCliOptions = {
  maxBuffer?: number;
};

export class Client {
  private cache = new Cache();
  private static VAULTS_CACHE_KEY = "vaults";
  private static ITEMS_CACHE_KEY = "items";
  private static TOTP_ITEMS_CACHE_KEY = "totp-items";

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

  private async getCachedItems(vaultName: string): Promise<ItemSummary[] | null> {
    const cachedItems = this.cache.get(`${Client.ITEMS_CACHE_KEY}:${vaultName}`);
    if (!cachedItems) return null;
    return this.parseItemSummaries(cachedItems);
  }

  // Item ids known to have TOTP, learned from prior `item view` calls. Lets the list
  // mark rows before their content is (re)fetched on hover.
  getTotpItemIds(): string[] {
    const raw = this.cache.get(Client.TOTP_ITEMS_CACHE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }

  private noteTotp(itemId: string, hasTotp: boolean) {
    const ids = new Set(this.getTotpItemIds());
    const changed = hasTotp ? !ids.has(itemId) : ids.delete(itemId);
    if (hasTotp) ids.add(itemId);
    if (changed) this.cache.set(Client.TOTP_ITEMS_CACHE_KEY, JSON.stringify([...ids]));
  }

  private setCachedItems(rawJson: string, vaultName: string) {
    this.cache.set(`${Client.ITEMS_CACHE_KEY}:${vaultName}`, rawJson);
  }

  // -- CLI Operations

  private async execCli(args: string[], options: ExecCliOptions = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(this.cliPath, args, options);

      const normalized = {
        stdout: typeof stdout === "string" ? stdout : stdout.toString("utf8"),
        stderr: typeof stderr === "string" ? stderr : stderr.toString("utf8"),
      };

      if (normalized.stderr.trim()) {
        throw mapCliError({ stderr: normalized.stderr, message: normalized.stdout });
      }

      return normalized;
    } catch (error) {
      throw mapCliError(error);
    }
  }

  private async getVaultName(vaultId: string): Promise<string | null> {
    const vaults = await this.getAllVaults();
    return vaults.find((v) => v.id === vaultId)?.title ?? null;
  }

  private getCachedVaultName(vaultId: string): string | null {
    return this.getCachedVaults()?.find((v) => v.id === vaultId)?.title ?? null;
  }

  async getAllVaults(forceRefresh: boolean = false): Promise<Vault[]> {
    const fetchAndRefreshVaults = async () => {
      const { stdout } = await this.execCli(["vault", "list", "--output=json"], { maxBuffer: MAX_BUFFER_SIZE });

      this.setCachedVaults(stdout);
      return stdout;
    };

    const cachedVaults = this.getCachedVaults();
    if (cachedVaults && !forceRefresh) {
      void fetchAndRefreshVaults().catch((error) =>
        showBackgroundRefreshError(error, "Failed to refresh vaults", fetchAndRefreshVaults),
      );
      return cachedVaults;
    }

    const vaultsJson = await fetchAndRefreshVaults();
    return this.parseVaults(vaultsJson);
  }

  // Lightweight: one `item list` call per vault. Full content is loaded lazily per item
  // via getItem() only when a detail is opened — keeps large vaults fast.
  async getItems(vaultName: string | null, forceRefresh: boolean = false): Promise<ItemSummary[]> {
    const fetchAndRefreshItems = async (targetVaultName: string) => {
      const { stdout } = await this.execCli(["item", "list", targetVaultName, "--output=json"], {
        maxBuffer: MAX_BUFFER_SIZE,
      });
      this.setCachedItems(stdout, targetVaultName);
      return stdout;
    };

    if (vaultName) {
      const cachedItems = await this.getCachedItems(vaultName);
      if (cachedItems != null && !forceRefresh) {
        void fetchAndRefreshItems(vaultName).catch((error) =>
          showBackgroundRefreshError(error, `Failed to refresh items from ${vaultName}`, () =>
            fetchAndRefreshItems(vaultName),
          ),
        );
        return cachedItems;
      }

      const itemsJson = await fetchAndRefreshItems(vaultName);
      return this.parseItemSummaries(itemsJson);
    }

    const vaults = await this.getAllVaults();
    const fetchPromises = vaults.map(async (vault) => {
      const cachedItems = await this.getCachedItems(vault.title);
      if (cachedItems != null && !forceRefresh) {
        void fetchAndRefreshItems(vault.title).catch((error) =>
          showBackgroundRefreshError(error, `Failed to refresh items from ${vault.title}`, () =>
            fetchAndRefreshItems(vault.title),
          ),
        );
        return cachedItems;
      }

      const itemsJson = await fetchAndRefreshItems(vault.title);
      return this.parseItemSummaries(itemsJson);
    });

    const results = await Promise.all(fetchPromises);
    return results.flat();
  }

  // Lazily load a single item's full content via `item view`, cached per item.
  async getItem(shareId: string, itemId: string, forceRefresh: boolean = false): Promise<Item | null> {
    const cacheKey = `item:${shareId}:${itemId}`;

    if (!forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        try {
          const cachedJson = JSON.parse(cached) as VaultItemJson;
          this.noteTotp(itemId, Boolean(cachedJson.content.content.Login?.totp_uri));
          return await this.parseItem(cachedJson);
        } catch {
          // fall through to refetch on malformed cache
        }
      }
    }

    // Use `=` form: item/share IDs are URL-safe base64 and may start with `-`,
    // which the CLI's arg parser would otherwise treat as a flag.
    const { stdout } = await this.execCli(
      ["item", "view", `--share-id=${shareId}`, `--item-id=${itemId}`, "--output", "json"],
      { maxBuffer: MAX_BUFFER_SIZE },
    );

    const itemJson = (JSON.parse(stdout) as ItemViewJson).item;
    if (!itemJson) return null;

    this.cache.set(cacheKey, JSON.stringify(itemJson));
    this.noteTotp(itemId, Boolean(itemJson.content.content.Login?.totp_uri));
    return await this.parseItem(itemJson);
  }

  async getItemTotp(vaultShareId: string, itemId: string): Promise<string | null> {
    try {
      const { stdout } = await this.execCli(
        ["item", "totp", `--share-id=${vaultShareId}`, `--item-id=${itemId}`, "--output", "json"],
        { maxBuffer: MAX_BUFFER_SIZE },
      );

      return parseTotp(stdout);
    } catch {
      return null;
    }
  }

  // --- Parsers that also hydrate caches ---

  private parseVaults(rawJson: string): Vault[] {
    const parsed = JSON.parse(rawJson) as VaultsJson;
    const vaults = parsed.vaults.map((v) => ({ title: v.name, id: v.vault_id, shareId: v.share_id }));
    return vaults;
  }

  private parseItemSummaries(rawJson: string): ItemSummary[] {
    const parsed = JSON.parse(rawJson) as ItemListJson;
    if (!parsed.items) return [];

    return parsed.items.map((entry) => ({
      id: entry.id,
      shareId: entry.share_id,
      vaultId: entry.vault_id,
      vaultTitle: this.getCachedVaultName(entry.vault_id) ?? undefined,
      state: entry.state,
      type: mapItemType(entry.item_type),
      title: entry.title ?? "",
      createTime: entry.create_time,
      modifyTime: entry.modify_time,
    }));
  }

  private async parseItem(it: VaultItemJson): Promise<Item> {
    const vaultName = await this.getVaultName(it.vault_id);
    const content = it.content.content;
    const baseItem = {
      id: it.id,
      shareId: it.share_id,
      title: it.content.title,
      vaultId: it.vault_id,
      state: it.state,
      vaultTitle: vaultName || undefined,
      notes: it.content.note || undefined,
      extraFields: parseItemFields(it.content.extra_fields),
      createTime: it.create_time,
      modifyTime: it.modify_time,
    };

    {
      if (content.Login) {
        return {
          ...baseItem,
          type: "Login",
          email: content.Login.email,
          username: content.Login.username,
          password: content.Login.password,
          urls: content.Login.urls,
          totpUri: content.Login.totp_uri,
        };
      }

      if (content.Identity) {
        return {
          ...baseItem,
          type: "Identity",
          full_name: content.Identity.full_name,
          email: content.Identity.email,
          phone_number: content.Identity.phone_number,
          first_name: content.Identity.first_name,
          middle_name: content.Identity.middle_name,
          last_name: content.Identity.last_name,
          birthdate: content.Identity.birthdate,
          gender: content.Identity.gender,
          extra_personal_details: content.Identity.extra_personal_details,
          organization: content.Identity.organization,
          street_address: content.Identity.street_address,
          zip_or_postal_code: content.Identity.zip_or_postal_code,
          city: content.Identity.city,
          state_or_province: content.Identity.state_or_province,
          country_or_region: content.Identity.country_or_region,
          floor: content.Identity.floor,
          county: content.Identity.county,
          social_security_number: content.Identity.social_security_number,
          passport_number: content.Identity.passport_number,
          license_number: content.Identity.license_number,
          website: content.Identity.website,
          x_handle: content.Identity.x_handle,
          second_phone_number: content.Identity.second_phone_number,
          linkedin: content.Identity.linkedin,
          reddit: content.Identity.reddit,
          facebook: content.Identity.facebook,
          yahoo: content.Identity.yahoo,
          instagram: content.Identity.instagram,
          company: content.Identity.company,
          job_title: content.Identity.job_title,
          personal_website: content.Identity.personal_website,
          work_phone_number: content.Identity.work_phone_number,
          work_email: content.Identity.work_email,
        };
      }

      if (content.CreditCard) {
        return {
          ...baseItem,
          type: "CreditCard",
          cardholder_name: content.CreditCard.cardholder_name,
          card_type: content.CreditCard.card_type,
          number: content.CreditCard.number,
          verification_number: content.CreditCard.verification_number,
          expiration_date: content.CreditCard.expiration_date,
          pin: content.CreditCard.pin,
        };
      }

      if (content.SshKey) {
        return {
          ...baseItem,
          type: "SSHKey",
          private_key: content.SshKey.private_key,
          public_key: content.SshKey.public_key,
          sections: parseItemSections(content.SshKey.sections),
        };
      }

      if (Object.hasOwn(content, "Note")) {
        return {
          ...baseItem,
          type: "Note",
        };
      }

      if (Object.hasOwn(content, "Alias")) {
        return {
          ...baseItem,
          type: "Alias",
        };
      }

      if (content.Custom) {
        return {
          ...baseItem,
          type: "Custom",
          sections: parseItemSections(content.Custom.sections),
        };
      }

      const originalType = Object.keys(content)[0] || "Unknown";
      const originalContent = Object.values(content)[0];

      return {
        ...baseItem,
        type: "Other",
        originalType,
        extraFields: mergeFields(baseItem.extraFields, parseUnknownFields(originalContent)),
        sections: parseUnknownSections(originalContent),
      };
    }
  }
}

function mapItemType(itemType?: string): ItemType {
  switch (itemType) {
    case "login":
      return "Login";
    case "identity":
      return "Identity";
    case "credit_card":
      return "CreditCard";
    case "ssh_key":
      return "SSHKey";
    case "note":
      return "Note";
    case "alias":
      return "Alias";
    case "custom":
      return "Custom";
    default:
      return "Other";
  }
}

function parseItemFields(fields?: ItemFieldJson[]): ItemField[] | undefined {
  const parsed = fields
    ?.map((field) => {
      const title = field.name?.trim();
      const hidden = field.content?.Hidden;
      const text = field.content?.Text;

      if (!title) return null;
      if (typeof hidden === "string") return { title, content: hidden, confidential: true };
      if (typeof text === "string") return { title, content: text };

      return null;
    })
    .filter((field): field is ItemField => field != null);

  return parsed && parsed.length > 0 ? parsed : undefined;
}

function parseItemSections(sections?: ItemSectionJson[]): ItemSection[] | undefined {
  const parsed = sections
    ?.map((section) => {
      const fields = parseItemFields(section.section_fields);
      if (!fields?.length) return null;

      return {
        title: section.section_name?.trim() || undefined,
        fields,
      };
    })
    .filter((section): section is ItemSection => section != null);

  return parsed && parsed.length > 0 ? parsed : undefined;
}

function parseUnknownFields(content: unknown): ItemField[] | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) return undefined;

  const fields = Object.entries(content)
    .filter(([key]) => key !== "sections")
    .map(([key, value]) => {
      if (typeof value === "string") return { title: formatFieldTitle(key), content: value };
      if (typeof value === "number" || typeof value === "boolean")
        return { title: formatFieldTitle(key), content: String(value) };
      if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        return { title: formatFieldTitle(key), content: value.join("\n") };
      }

      return null;
    })
    .filter((field): field is ItemField => field != null);

  return fields.length > 0 ? fields : undefined;
}

function parseUnknownSections(content: unknown): ItemSection[] | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content) || !("sections" in content)) return undefined;

  const sections = (content as { sections?: ItemSectionJson[] }).sections;
  return parseItemSections(sections);
}

function mergeFields(primary?: ItemField[], secondary?: ItemField[]): ItemField[] | undefined {
  const merged = [...(primary ?? [])];

  for (const field of secondary ?? []) {
    if (!merged.some((entry) => entry.title === field.title && entry.content === field.content)) {
      merged.push(field);
    }
  }

  return merged.length > 0 ? merged : undefined;
}

function formatFieldTitle(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w|\s\w/g, (match) => match.toUpperCase());
}

function getCliPath() {
  const preferences = getPreferenceValues<ExtensionPreferences>();

  const cliPath = [preferences.cliPath, `${homedir()}/.local/bin/pass-cli`]
    .filter(Boolean)
    .find((path) => (path ? existsSync(path) : false));

  if (!cliPath) {
    throw new PassCliError(
      "not_installed",
      "Proton Pass CLI is not found. Please set the path in the extension preferences.",
    );
  }

  return cliPath;
}
// Single in-memory client
let client: Client | null = null;
let loginPromise: Promise<void> | null = null;

export function getPassClient() {
  if (!client) {
    client = new Client(getCliPath());
  }
  return client;
}

export function resetPassCache() {
  const cache = new Cache();
  cache.clear();
}

export async function loginToPassCli() {
  return ensurePassCliLogin(getCliPath());
}

async function ensurePassCliLogin(cliPath: string) {
  if (!loginPromise) {
    loginPromise = runPassCliLogin(cliPath).finally(() => {
      loginPromise = null;
    });
  }

  return loginPromise;
}

async function runPassCliLogin(cliPath: string): Promise<void> {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Opening Proton Pass Login",
    message: "Waiting for Proton Pass to provide the login URL.",
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cliPath, ["login"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let urlOpened = false;

      const fail = (message: string) => {
        if (!child.killed) child.kill();
        reject(new PassCliError("not_authenticated", message));
      };

      const maybeOpenLoginUrl = async () => {
        if (urlOpened) return;

        const combined = `${stdout}\n${stderr}`;
        const match = combined.match(LOGIN_URL_PATTERN);
        if (!match) return;

        urlOpened = true;
        toast.title = "Complete Proton Pass Login";
        toast.message = "Finish the Proton Pass sign-in flow in your browser.";

        try {
          await open(match[0]);
        } catch {
          fail(`${LOGIN_FAILURE_MESSAGE} URL: ${match[0]}`);
        }
      };

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
        void maybeOpenLoginUrl();
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
        void maybeOpenLoginUrl();
      });

      child.on("error", () => {
        reject(new PassCliError("not_authenticated", LOGIN_FAILURE_MESSAGE));
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
        reject(
          new PassCliError(
            "not_authenticated",
            details ? `${LOGIN_FAILURE_MESSAGE}\n\n${details}` : LOGIN_FAILURE_MESSAGE,
          ),
        );
      });
    });

    toast.style = Toast.Style.Success;
    toast.title = "Proton Pass Login Complete";
    toast.message = "Retrying your original command.";
  } catch (error) {
    const passError = mapCliError(error);
    toast.style = Toast.Style.Failure;
    toast.title = "Proton Pass Login Failed";
    toast.message = passError.message;
    throw passError;
  }
}

const mapCliError = (error: unknown): PassCliError => {
  if (error instanceof PassCliError) return error;

  const { message, stderr, code } = extractCliErrorDetails(error);
  const combined = [stderr, message].filter(Boolean).join("\n");

  const has = (pattern: RegExp) => pattern.test(combined);

  if (has(/ENOENT|not found|no such file/i)) {
    return new PassCliError("not_installed", "Proton Pass CLI is not installed or not found on disk.");
  }

  if (
    has(/not logged in|authenticated|not authenticated|login required|please login|no session|there is no session/i)
  ) {
    return new PassCliError("not_authenticated", "You are not logged in to Proton Pass CLI.");
  }

  if (has(/keyring|keychain|secret service|org\.freedesktop\.secrets/i)) {
    return new PassCliError("keyring_error", "Proton Pass CLI could not access secure key storage.");
  }

  if (code === "ETIMEDOUT" || has(/timed out|timeout/i)) {
    return new PassCliError("timeout", "Proton Pass CLI request timed out.");
  }

  if (has(/network|connection|ECONN|ENOTFOUND|EAI_AGAIN|addresses/i)) {
    return new PassCliError("network_error", "Network error while contacting Proton Pass.");
  }

  return new PassCliError("unknown", combined || "An unknown error occurred.");
};

const extractCliErrorDetails = (error: unknown): { message?: string; stderr?: string; code?: string } => {
  if (!error || typeof error !== "object") {
    return { message: typeof error === "string" ? error : undefined };
  }

  const message = "message" in error && typeof error.message === "string" ? error.message : undefined;
  const stderrRaw = "stderr" in error ? (error.stderr as unknown) : undefined;
  const stderr =
    typeof stderrRaw === "string" ? stderrRaw : Buffer.isBuffer(stderrRaw) ? stderrRaw.toString("utf8") : undefined;
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;

  return { message, stderr, code };
};

const parseTotp = (rawOutput: string): string | null => {
  const output = rawOutput.trim();
  if (!output) return null;

  try {
    const parsed = JSON.parse(output) as ItemTotpJson | string;

    if (typeof parsed === "string") {
      return parsed.trim() || null;
    }

    const totpValue = [parsed.totp, parsed.code, parsed.value, parsed.token].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );

    return totpValue?.trim() || null;
  } catch {
    return output;
  }
};

const showBackgroundRefreshError = (error: unknown, title: string, onAuthenticate?: () => Promise<unknown>) => {
  const passError = mapCliError(error);

  if (passError.type === "not_authenticated") {
    void showToast({
      style: Toast.Style.Failure,
      title,
      message: passError.message,
      primaryAction: {
        title: "Log in to Proton Pass",
        onAction: () => {
          void (async () => {
            await loginToPassCli();

            if (!onAuthenticate) return;

            try {
              await onAuthenticate();
            } catch (refreshError) {
              showBackgroundRefreshError(refreshError, title, onAuthenticate);
            }
          })();
        },
      },
    });
    return;
  }

  void showToast(Toast.Style.Failure, title, passError.message);
};
