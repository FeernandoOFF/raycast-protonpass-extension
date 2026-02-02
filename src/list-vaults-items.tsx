import { ActionPanel, Action, Icon, List, getPreferenceValues } from "@raycast/api";
import { useVaultItems } from "./lib/pass/useVaultItems";

interface Preferences {
  cliPath: string;
}

export default function ListVaultsItems(
  props: { vaultName: string },
) {
  const { cliPath } = getPreferenceValues<Preferences>();
  const { items, isLoading } = useVaultItems(cliPath, props.vaultName);

  return (
    <List navigationTitle={`Items in ${props.vaultName ?? "All Vaults"}`} isLoading={isLoading}>
      {items.map((item) => {
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
                    <Action.CopyToClipboard title="Copy Email" content={item.email} shortcut={{ modifiers: ["cmd"], key: "c" }} />
                  )}
                  {item.password && (
                    <Action.CopyToClipboard title="Copy Password" content={item.password} shortcut={{ modifiers: ["cmd", "shift"], key: "c" }} />
                  )}
                </ActionPanel.Section>
                <ActionPanel.Section>
                  {item.urls?.map((url, index) => (
                    <Action.OpenInBrowser key={index} title={`Open ${url}`} url={url} />
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
