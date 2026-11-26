import { Alert, Platform, type AlertButton } from 'react-native';

function getDialogMessage(title: string, message?: string): string {
  return message ? `${title}\n\n${message}` : title;
}

function runButton(button: AlertButton | undefined): void {
  button?.onPress?.();
}

export function showAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[]
): void {
  if (Platform.OS !== 'web') {
    if (buttons === undefined) {
      Alert.alert(title, message);
    } else {
      Alert.alert(title, message, buttons);
    }
    return;
  }

  const dialogMessage = getDialogMessage(title, message);
  if (!buttons?.length) {
    window.alert(dialogMessage);
    return;
  }

  if (buttons.length === 1) {
    window.alert(dialogMessage);
    runButton(buttons[0]);
    return;
  }

  if (buttons.length === 2) {
    const cancelIndex = buttons.findIndex((button) => button.style === 'cancel');
    const cancelButtonIndex = cancelIndex >= 0 ? cancelIndex : 1;
    const primaryIndex = cancelButtonIndex === 0 ? 1 : 0;
    const confirmed = window.confirm(
      `${dialogMessage}\n\n${buttons[primaryIndex]?.text ?? 'Continue'}?`
    );
    runButton(buttons[confirmed ? primaryIndex : cancelButtonIndex]);
    return;
  }

  const choices = buttons
    .map((button, index) => `${index + 1}. ${button.text ?? `Option ${index + 1}`}`)
    .join('\n');
  const selection = window.prompt(
    `${dialogMessage}\n\n${choices}\n\nEnter the option number:`,
    '1'
  );
  if (selection === null) return;

  const selectedIndex = Number(selection) - 1;
  if (!Number.isInteger(selectedIndex) || !buttons[selectedIndex]) {
    window.alert('Please choose a valid option.');
    return;
  }
  runButton(buttons[selectedIndex]);
}
