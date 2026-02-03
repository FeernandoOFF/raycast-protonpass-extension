import { Action, ActionPanel, Icon, List, useNavigation } from "@raycast/api";
import ListVaultsItems from "./list-vaults-items";
import { useVaults } from "./lib/pass/useVaults";

export default function ListVaults() {
  const { vaults, isLoading } = useVaults();
  const { push } = useNavigation();

  return (
    <List isLoading={isLoading}>
      {vaults != null &&
        vaults.map((vault) => (
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