import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useVaultItems } from "./lib/pass/useVaultItems";
import { useMemo, useState } from "react";

export default function ListVaultsItems(
  props: { vaultName: string },
) {
  const { items, isLoading} = useVaultItems(props.vaultName);
  const [filter, setFilter] = useState<string>("Active");

  const filteredItems = useMemo(()=> items?.filter(item => item.state === filter), [items, filter])

  return (
    <List navigationTitle={`Items in ${props.vaultName ?? "All Vaults"}`} isLoading={isLoading}
          searchBarAccessory={
      <List.Dropdown tooltip={"Filter items by state"} onChange={setFilter}>
        <List.Dropdown.Item title="Active" value="Active" />
        <List.Dropdown.Item title="Trashed" value="Trashed" />
      </List.Dropdown>
            
    }>
      {filteredItems != null && filteredItems.map((item) => {
        const accessories: List.Item.Accessory[] = [];
        if (item.urls && item.urls.length > 0) {
          try {
            const url = new URL(item.urls[0]);
            accessories.push({ text: url.hostname, tooltip: item.urls[0] });
          } catch {
            accessories.push({ text: item.urls[0], tooltip: item.urls[0] });
          }
        }

        if (item.vaultTitle) {
          accessories.push({ text: item.vaultTitle, tooltip: "Vault" });
        }

        return (
          <List.Item
            key={item.id}
            icon={Icon.Lock}
            title={item.title}
            accessories={accessories}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  {item.email && (
                    <Action.CopyToClipboard
                      title="Copy Email"
                      content={item.email}
                      shortcut={{ modifiers: ["cmd"], key: "c" }}
                    />
                  )}
                  {item.password && (
                    <Action.CopyToClipboard
                      title="Copy Password"
                      content={item.password}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                    />
                  )}
                </ActionPanel.Section>
                <ActionPanel.Section>
                  {item.urls?.map((url, index) => (
                    <Action.OpenInBrowser
                      key={index}
                      title={`Open ${url}`}
                      url={url}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
                    />
                  ))}
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
