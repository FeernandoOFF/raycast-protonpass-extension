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
  notes?: string;
  extraFields?: ItemField[];
  sections?: ItemSection[];
  createTime?: number | string;
  modifyTime?: number | string;
};

export type ItemField = {
  title: string;
  content: string;
  confidential?: boolean;
};

export type ItemSection = {
  title?: string;
  fields: ItemField[];
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
  city?: string;
  state_or_province?: string;
  country_or_region?: string;
  floor?: string;
  county?: string;
  social_security_number?: string;
  passport_number?: string;
  license_number?: string;
  website?: string;
  x_handle?: string;
  second_phone_number?: string;
  linkedin?: string;
  reddit?: string;
  facebook?: string;
  yahoo?: string;
  instagram?: string;
  company?: string;
  job_title?: string;
  personal_website?: string;
  work_phone_number?: string;
  work_email?: string;
};

export type CreditCardItem = BaseItem & {
  type: "CreditCard";
  cardholder_name?: string;
  card_type?: string;
  number?: string;
  verification_number?: string;
  expiration_date?: string;
  pin?: string;
};

export type SSHKeyItem = BaseItem & {
  type: "SSHKey";
  private_key?: string;
  public_key?: string;
};

export type NoteItem = BaseItem & {
  type: "Note";
};

export type AliasItem = BaseItem & {
  type: "Alias";
};

export type CustomItem = BaseItem & {
  type: "Custom";
};

export type OtherItem = BaseItem & {
  type: "Other";
  originalType: string;
};

export type Item =
  | LoginItem
  | IdentityItem
  | CreditCardItem
  | SSHKeyItem
  | NoteItem
  | AliasItem
  | CustomItem
  | OtherItem;

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
  create_time?: number | string;
  modify_time?: number | string;
  content: {
    title: string;
    note?: string;
    item_uuid?: string;
    extra_fields?: ItemFieldJson[];
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
        city?: string;
        state_or_province?: string;
        country_or_region?: string;
        floor?: string;
        county?: string;
        social_security_number?: string;
        passport_number?: string;
        license_number?: string;
        website?: string;
        x_handle?: string;
        second_phone_number?: string;
        linkedin?: string;
        reddit?: string;
        facebook?: string;
        yahoo?: string;
        instagram?: string;
        company?: string;
        job_title?: string;
        personal_website?: string;
        work_phone_number?: string;
        work_email?: string;
      };
      CreditCard?: {
        cardholder_name?: string;
        card_type?: string;
        number?: string;
        verification_number?: string;
        expiration_date?: string;
        pin?: string;
      };
      SshKey?: {
        private_key?: string;
        public_key?: string;
        sections?: ItemSectionJson[];
      };
      Note?: null;
      Alias?: null;
      Custom?: {
        sections?: ItemSectionJson[];
      };
    };
  };
};

export type ItemFieldJson = {
  name?: string;
  content?: {
    Text?: string;
    Hidden?: string;
  };
};

export type ItemSectionJson = {
  section_name?: string;
  section_fields?: ItemFieldJson[];
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
