import { Action, ActionPanel, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useVaults } from "./lib/pass/useVaults";
import ListVaultsItems from "./list-vaults-items";
import { useEffect } from "react";

export default function ListVaults() {
  const { vaults, isLoading, error } = useVaults();
  const { push } = useNavigation();

  useEffect(() => {
    if (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: error.message,
      });
    }
  }, [error]);



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