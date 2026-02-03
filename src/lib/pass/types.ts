export type Vault = {
  title: string;
  id: string;
};

export type Item = {
  title: string;
  email?: string;
  password?: string;
  id: string;
  vaultId: string;
  vaultTitle?: string;
  urls?: string[];
  state: "Active" | "Trashed";
};

export type VaultsJson = { vaults: { name: string; vault_id: string }[] };
export type ItemsJson = {
  items: {
    id: string;
    vault_id: string;
    state: "Active" | "Trashed";
    content: {
      title: string;
      content: {
        Login?: {
          email: string;
          password: string;
          urls?: string[];
        };
      };
    };
  }[];
};
