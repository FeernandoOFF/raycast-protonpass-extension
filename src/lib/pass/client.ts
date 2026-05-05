import { Item, ItemTotpJson, ItemsJson, PassCliError, Vault, VaultsJson } from "./types";
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

  async getItems(vaultName: string | null, forceRefresh: boolean = false): Promise<Item[]> {
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
      return this.parseItems(itemsJson);
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
      return this.parseItems(itemsJson);
    });

    const results = await Promise.all(fetchPromises);
    return results.flat();
  }

  async getItemTotp(vaultShareId: string, itemId: string): Promise<string | null> {
    try {
      const { stdout } = await this.execCli(
        ["item", "totp", "--share-id", vaultShareId, "--item-id", itemId, "--output", "json"],
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

  private async parseItems(rawJson: string): Promise<Item[]> {
    const parsed = JSON.parse(rawJson) as ItemsJson;
    if (!parsed.items || parsed.items.length === 0) return [];
    const vaultName = await this.getVaultName(parsed.items[0].vault_id);

    const items: Item[] = parsed.items.map((it) => {
      const content = it.content.content;

      if (content.Login) {
        return {
          id: it.id,
          shareId: it.share_id,
          title: it.content.title,
          vaultId: it.vault_id,
          state: it.state,
          vaultTitle: vaultName || undefined,
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
          id: it.id,
          shareId: it.share_id,
          title: it.content.title,
          vaultId: it.vault_id,
          state: it.state,
          vaultTitle: vaultName || undefined,
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
        };
      }

      if (content.CreditCard) {
        return {
          id: it.id,
          shareId: it.share_id,
          title: it.content.title,
          vaultId: it.vault_id,
          state: it.state,
          vaultTitle: vaultName || undefined,
          type: "CreditCard",
          cardholder_name: content.CreditCard.cardholder_name,
          card_type: content.CreditCard.card_type,
          number: content.CreditCard.number,
          verification_number: content.CreditCard.verification_number,
          expiration_date: content.CreditCard.expiration_date,
        };
      }

      if (content.SshKey) {
        return {
          id: it.id,
          shareId: it.share_id,
          title: it.content.title,
          vaultId: it.vault_id,
          state: it.state,
          vaultTitle: vaultName || undefined,
          type: "SSHKey",
          private_key: content.SshKey.private_key,
          public_key: content.SshKey.public_key,
        };
      }

      // Fallback: treat as Login with basic fields to avoid crashes
      return {
        id: it.id,
        shareId: it.share_id,
        title: it.content.title,
        vaultId: it.vault_id,
        state: it.state,
        vaultTitle: vaultName || undefined,
        type: "Login",
      };
    });
    return items;
  }
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
