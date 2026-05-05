export type Vault = {
  title: string;
  id: string;
  shareId?: string;
};

// Discriminated union item types
export type BaseItem = {
  title: string;
  id: string;
  shareId?: string;
  vaultId: string;
  vaultTitle?: string;
  state: "Active" | "Trashed";
  totp?: string;
};

export type LoginItem = BaseItem & {
  type: "Login";
  email?: string;
  username?: string;
  password?: string;
  urls?: string[];
  totpUri?: string;
};

export type IdentityItem = BaseItem & {
  type: "Identity";
  full_name?: string;
  email?: string;
  phone_number?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  birthdate?: string;
  gender?: string;
  extra_personal_details?: string[];
  organization?: string;
  street_address?: string;
  zip_or_postal_code?: string;
};

export type CreditCardItem = BaseItem & {
  type: "CreditCard";
  cardholder_name?: string;
  card_type?: string;
  number?: string;
  verification_number?: string;
  expiration_date?: string;
};

export type SSHKeyItem = BaseItem & {
  type: "SSHKey";
  private_key?: string;
  public_key?: string;
};

export type Item = LoginItem | IdentityItem | CreditCardItem | SSHKeyItem;

// -- Errors

export const PROTON_PASS_CLI_DOCS = "https://protonpass.github.io/pass-cli/";

export type PassCliErrorType =
  | "not_installed"
  | "not_authenticated"
  | "keyring_error"
  | "network_error"
  | "timeout"
  | "unknown";

export class PassCliError extends Error {
  readonly type: PassCliErrorType;

  constructor(type: PassCliErrorType, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PassCliError";
    this.type = type;
  }
}

export const isPassCliError = (error: unknown): error is PassCliError => {
  return error instanceof PassCliError;
};

export const coercePassCliError = (error: unknown): PassCliError => {
  if (error instanceof PassCliError) return error;
  const message = error instanceof Error ? error.message : "An unknown error occurred.";
  return new PassCliError("unknown", message);
};

// -- JSON

export type VaultsJson = { vaults: { name: string; vault_id: string; share_id: string }[] };

export type VaultItemJson = {
  id: string;
  share_id: string;
  vault_id: string;
  state: "Active" | "Trashed";
  content: {
    title: string;
    content: {
      Login?: {
        email?: string;
        username?: string;
        password?: string;
        urls?: string[];
        totp_uri?: string;
      };
      Identity?: {
        full_name?: string;
        email?: string;
        phone_number?: string;
        first_name?: string;
        middle_name?: string;
        last_name?: string;
        birthdate?: string;
        gender?: string;
        extra_personal_details?: string[];
        organization?: string;
        street_address?: string;
        zip_or_postal_code?: string;
      };
      CreditCard?: {
        cardholder_name?: string;
        card_type?: string;
        number?: string;
        verification_number?: string;
        expiration_date?: string;
      };
      SshKey?: {
        private_key?: string;
        public_key?: string;
      };
    };
  };
};

export type ItemsJson = {
  items: VaultItemJson[];
};

export type ItemTotpJson = {
  totp?: string;
  code?: string;
  value?: string;
  token?: string;
};
