import { Icon, List } from "@raycast/api";
import { useVaultItems } from "./lib/pass/useVaultItems";
import { useMemo, useState } from "react";
import { useVaults } from "./lib/pass/useVaults";
import { ErrorListView } from "./lib/components/error";
import { ItemActionPanel } from "./lib/components/item-detail";

export default function ListVaultsItems(props: { vaultName?: string | null }) {
  const { vaults } = useVaults();
  const { items, isLoading, error, revalidate } = useVaultItems(props.vaultName);
  const [filter, setFilter] = useState<string>("Active");
  const showVaultFilter = props.vaultName == null;

  const filteredItems = useMemo(() => {
    if (filter == "All") return items;
    else if (filter == "Active" || filter == "Trashed") {
      // Filter state
      return items?.filter((item) => item.state === filter);
    } else {
      // Filter vault
      return items?.filter((item) => item.vaultTitle === filter);
    }
  }, [items, filter]);

  return (
    <List
      searchBarPlaceholder={`Search items in ${props.vaultName ?? "All Vaults"}...`}
      navigationTitle={`Items in ${props.vaultName ?? "All Vaults"}`}
      isLoading={isLoading}
      searchBarAccessory={
        <List.Dropdown
          tooltip={showVaultFilter ? "Filter items by status or vault" : "Filter items by status"}
          onChange={setFilter}
          value={filter}
        >
          <List.Dropdown.Item title="All" value="All" icon={Icon.AppWindowGrid3x3} />
          <List.Dropdown.Section title="Status">
            <List.Dropdown.Item title="Active" value="Active" icon={Icon.CheckCircle} />
            <List.Dropdown.Item title="Trashed" value="Trashed" icon={Icon.Trash} />
          </List.Dropdown.Section>
          {showVaultFilter && (
            <List.Dropdown.Section title="Vaults">
              {vaults?.map((vault) => {
                return <List.Dropdown.Item title={vault.title} value={vault.title} key={vault.id} icon={Icon.Folder} />;
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
              actions={<ItemActionPanel item={item} showOpenDetails />}
            />
          );
        })}
    </List>
  );
}
