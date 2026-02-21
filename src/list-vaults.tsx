import { Action, ActionPanel, Icon, List, useNavigation } from "@raycast/api";
import ListVaultsItems from "./list-vaults-items";
import { useVaults } from "./lib/pass/useVaults";
import { ErrorListView } from "./lib/components/error";

export default function ListVaults() {
  const { vaults, isLoading, error, revalidate } = useVaults();
  const { push } = useNavigation();

  return (
    <List searchBarPlaceholder="Search vaults..." isLoading={isLoading}>
      {error != null && <ErrorListView error={error} onRetry={revalidate} contextTitle="load vaults" />}
      {vaults != null &&
        vaults.map((vault) => (
          <List.Item
            key={vault.id}
            icon={Icon.Lock}
            title={vault.title}
            accessories={[{ text: "Vault" }]}
            actions={
              <ActionPanel>
                <Action title="Open Vault" onAction={() => push(<ListVaultsItems vaultName={vault.title} />)} />
              </ActionPanel>
            }
          />
        ))}
    </List>
  );
}
