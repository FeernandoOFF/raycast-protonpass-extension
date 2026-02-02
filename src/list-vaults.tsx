import { ActionPanel, Action, Icon, List, useNavigation, getPreferenceValues } from "@raycast/api";
import { useVaults } from "./lib/pass/useVaults";
import ListVaultsItems from "./list-vaults-items";

interface Preferences {
  cliPath: string;
}

export default function ListVaults() {
  const { cliPath } = getPreferenceValues<Preferences>();
  const { vaults, isLoading } = useVaults(cliPath);
  const { push } = useNavigation();


  return (
    <List isLoading={isLoading}>
      {vaults.map((vault) => (
        <List.Item
          key={vault.id}
          icon={Icon.Lock}
          title={vault.title}
          accessories={[{ text: "Vault" }]}
          actions={
            <ActionPanel>
              <Action title="Push" onAction={() => push(<ListVaultsItems vaultName={vault.title} />)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
  }