import { Action, ActionPanel, Icon, List, openExtensionPreferences } from "@raycast/api";
import { JSX } from "react";
import { PassCliError, PassCliErrorType, PROTON_PASS_CLI_DOCS, coercePassCliError } from "../pass/types";
import { loginToPassCli, resetPassCache } from "../pass/client";

interface ErrorViewProps {
  error: unknown;
  onRetry?: () => void;
  contextTitle?: string;
}

interface ErrorConfig {
  icon: Icon;
  title: string;
  description: string;
  showDocsLink: boolean;
  showRetry: boolean;
  showPreferences: boolean;
  showResetCache: boolean;
}

const getErrorConfig = (errorType: PassCliErrorType, error: PassCliError, contextTitle?: string): ErrorConfig => {
  switch (errorType) {
    case "not_installed":
      return {
        icon: Icon.XMarkCircle,
        title: "Proton Pass CLI Not Installed",
        description:
          "You need to install the Proton Pass CLI to use this extension. Click below to learn how to install it.",
        showDocsLink: true,
        showRetry: false,
        showPreferences: true,
        showResetCache: false,
      };
    case "not_authenticated":
      return {
        icon: Icon.Lock,
        title: "Not Logged In",
        description:
          error.message || "Use the action below to open the Proton Pass login URL, or run 'pass-cli login' manually.",
        showDocsLink: true,
        showRetry: true,
        showPreferences: false,
        showResetCache: false,
      };
    case "keyring_error":
      return {
        icon: Icon.Key,
        title: "Keyring Access Failed",
        description:
          "pass-cli could not access secure key storage. Try: pass-cli logout --force, then set PROTON_PASS_KEY_PROVIDER=fs and login again.",
        showDocsLink: true,
        showRetry: true,
        showPreferences: false,
        showResetCache: true,
      };
    case "network_error":
      return {
        icon: Icon.Wifi,
        title: "Network Error",
        description: "Check your internet connection and try again.",
        showDocsLink: false,
        showRetry: true,
        showPreferences: false,
        showResetCache: false,
      };
    case "timeout":
      return {
        icon: Icon.Clock,
        title: "Request Timed Out",
        description: "pass-cli took too long to respond. Please try again.",
        showDocsLink: false,
        showRetry: true,
        showPreferences: false,
        showResetCache: false,
      };
    default:
      return {
        icon: Icon.ExclamationMark,
        title: contextTitle ? `Failed to ${contextTitle}` : "An Error Occurred",
        description: error.message || "An error occurred. Please try again.",
        showDocsLink: true,
        showRetry: true,
        showPreferences: true,
        showResetCache: true,
      };
  }
};

export function ErrorListView({ error, onRetry, contextTitle }: ErrorViewProps) {
  const passError = coercePassCliError(error);
  const config = getErrorConfig(passError.type, passError, contextTitle);

  const handleLogin = async () => {
    await loginToPassCli();
    onRetry?.();
  };

  return (
    <List.EmptyView
      icon={config.icon}
      title={config.title}
      description={config.description}
      actions={
        <ActionPanel>
          {passError.type === "not_authenticated" && (
            <Action title="Log in to Proton Pass" icon={Icon.Globe} onAction={handleLogin} />
          )}
          {config.showRetry && onRetry && <Action title="Retry" icon={Icon.ArrowClockwise} onAction={onRetry} />}
          {config.showPreferences && (
            <Action icon={Icon.Gear} onAction={openExtensionPreferences} title="Open Extension Preferences" />
          )}
          {config.showDocsLink && (
            <Action.OpenInBrowser title="Open Proton Pass CLI Docs" url={PROTON_PASS_CLI_DOCS} icon={Icon.Globe} />
          )}
          {config.showResetCache && <Action icon={Icon.Trash} onAction={resetPassCache} title="Reset Cache" />}
        </ActionPanel>
      }
    />
  );
}

export function renderErrorView(error: unknown, onRetry?: () => void, contextTitle?: string): JSX.Element | null {
  if (!error) return null;
  return <ErrorListView error={error} onRetry={onRetry} contextTitle={contextTitle} />;
}
