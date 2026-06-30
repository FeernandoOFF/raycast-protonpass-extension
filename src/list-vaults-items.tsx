import { Icon, List } from "@raycast/api";
import { useVaultItems } from "./lib/pass/useVaultItems";
import { useMemo, useState } from "react";
import { useVaults } from "./lib/pass/useVaults";
import { ErrorListView } from "./lib/components/error";
import { ItemSummaryActions } from "./lib/components/item-detail";

const ALL_FILTER = "all";
const STATUS_FILTER_PREFIX = "status:";
const TYPE_FILTER_PREFIX = "type:";
const VAULT_FILTER_PREFIX = "vault:";

export default function ListVaultsItems(props: { vaultName?: string | null }) {
  const { vaults } = useVaults();
  const { items, isLoading, error, revalidate } = useVaultItems(props.vaultName);
  const [filter, setFilter] = useState<string>(`${STATUS_FILTER_PREFIX}Active`);
  const showVaultFilter = props.vaultName == null;

  const filteredItems = useMemo(() => {
    if (filter === ALL_FILTER) return items;
    if (filter.startsWith(STATUS_FILTER_PREFIX)) {
      const state = filter.slice(STATUS_FILTER_PREFIX.length);
      return items?.filter((item) => item.state === state);
    }
    if (filter.startsWith(TYPE_FILTER_PREFIX)) {
      const type = filter.slice(TYPE_FILTER_PREFIX.length);
      return items?.filter((item) => item.type === type);
    }
    if (filter.startsWith(VAULT_FILTER_PREFIX)) {
      const vaultId = filter.slice(VAULT_FILTER_PREFIX.length);
      return items?.filter((item) => item.vaultId === vaultId);
    }

    return items;
  }, [items, filter]);

  return (
    <List
      searchBarPlaceholder={`Search items in ${props.vaultName ?? "All Vaults"}...`}
      navigationTitle={`Items in ${props.vaultName ?? "All Vaults"}`}
      isLoading={isLoading}
      searchBarAccessory={
        <List.Dropdown
          tooltip={showVaultFilter ? "Filter items by status, type, or vault" : "Filter items by status or type"}
          onChange={setFilter}
          value={filter}
        >
          <List.Dropdown.Item title="All" value={ALL_FILTER} icon={Icon.AppWindowGrid3x3} />
          <List.Dropdown.Section title="Status">
            <List.Dropdown.Item title="Active" value={`${STATUS_FILTER_PREFIX}Active`} icon={Icon.CheckCircle} />
            <List.Dropdown.Item title="Trashed" value={`${STATUS_FILTER_PREFIX}Trashed`} icon={Icon.Trash} />
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Type">
            <List.Dropdown.Item title="Logins" value={`${TYPE_FILTER_PREFIX}Login`} icon={Icon.Lock} />
            <List.Dropdown.Item title="Identities" value={`${TYPE_FILTER_PREFIX}Identity`} icon={Icon.Person} />
            <List.Dropdown.Item title="Credit Cards" value={`${TYPE_FILTER_PREFIX}CreditCard`} icon={Icon.CreditCard} />
            <List.Dropdown.Item title="SSH Keys" value={`${TYPE_FILTER_PREFIX}SSHKey`} icon={Icon.Key} />
            <List.Dropdown.Item title="Notes" value={`${TYPE_FILTER_PREFIX}Note`} icon={Icon.Document} />
            <List.Dropdown.Item title="Aliases" value={`${TYPE_FILTER_PREFIX}Alias`} icon={Icon.AtSymbol} />
            <List.Dropdown.Item title="Custom" value={`${TYPE_FILTER_PREFIX}Custom`} icon={Icon.List} />
            <List.Dropdown.Item title="Other" value={`${TYPE_FILTER_PREFIX}Other`} icon={Icon.QuestionMark} />
          </List.Dropdown.Section>
          {showVaultFilter && (
            <List.Dropdown.Section title="Vaults">
              {vaults?.map((vault) => {
                return (
                  <List.Dropdown.Item
                    title={vault.title}
                    value={`${VAULT_FILTER_PREFIX}${vault.id}`}
                    key={vault.id}
                    icon={Icon.Folder}
                  />
                );
              })}
            </List.Dropdown.Section>
          )}
        </List.Dropdown>
      }
    >
      {error != null && <ErrorListView error={error} onRetry={revalidate} contextTitle="load items" />}
      {filteredItems != null &&
        filteredItems.map((item) => {
          return (
            <List.Item
              key={item.id}
              icon={item.icon}
              title={item.title}
              accessories={item.accessories}
              actions={<ItemSummaryActions summary={item} />}
            />
          );
        })}
    </List>
  );
}
