import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { check } from '@tauri-apps/plugin-updater';

import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { Section } from '@astryxdesign/core/Section';

import { ipc, type AiProfile } from '../lib/ipc';
import { useAppStore } from '../state/appStore';

const PROFILE_OPTIONS = [
  { value: 'best', label: 'Best · GPT-5.6 Sol · high reasoning' },
  { value: 'balanced', label: 'Balanced · GPT-5.6 Terra · medium reasoning' },
  { value: 'fast', label: 'Fast · GPT-5.6 Luna · low reasoning' },
];

const RETENTION_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '0', label: 'Keep until deleted' },
];

export function SettingsDialog() {
  const queryClient = useQueryClient();
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setProfile = useAppStore((state) => state.setProfile);
  const setConversationId = useAppStore(
    (state) => state.setConversationId,
  );
  const setCapture = useAppStore((state) => state.setCapture);
  const setContextItems = useAppStore((state) => state.setContextItems);
  const [keyDraft, setKeyDraft] = useState('');
  const [shortcutDraft, setShortcutDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const apiKeyQuery = useQuery({
    queryKey: ['hasApiKey'],
    queryFn: () => ipc.hasApiKey(),
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => ipc.getSettings(),
  });

  useEffect(() => {
    if (settingsQuery.data != null) {
      setShortcutDraft(settingsQuery.data.shortcut);
    }
  }, [settingsQuery.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['hasApiKey'] }),
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
    ]);
  };

  const saveKey = async () => {
    if (keyDraft.trim().length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      await ipc.setApiKey(keyDraft.trim());
      setKeyDraft('');
      setNotice('API key stored in Windows Credential Manager.');
      await refresh();
    } catch (error) {
      setNotice(`Failed to store key: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveShortcut = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const settings = await ipc.setShortcut(shortcutDraft);
      setShortcutDraft(settings.shortcut);
      setNotice(`Global shortcut changed to ${settings.shortcut}.`);
      await refresh();
    } catch (error) {
      setNotice(String(error));
      setShortcutDraft(settingsQuery.data?.shortcut ?? 'Ctrl+Shift+Space');
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setBusy(true);
    try {
      await ipc.clearApiKey();
      setNotice('API key removed.');
      await refresh();
    } catch (error) {
      setNotice(`Could not remove key: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    setBusy(true);
    try {
      const path = await ipc.exportData();
      setNotice(`Local data exported to ${path}`);
    } catch (error) {
      setNotice(`Export failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const exportDiagnostics = async () => {
    setBusy(true);
    try {
      const path = await ipc.exportDiagnostics();
      setNotice(`Redacted diagnostics exported to ${path}`);
    } catch (error) {
      setNotice(`Diagnostics export failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const checkForUpdates = async () => {
    setBusy(true);
    setNotice('Checking for updates…');
    try {
      const update = await check();
      if (update == null || !update.available) {
        setNotice('LightBridge is up to date.');
      } else {
        setNotice(`Downloading LightBridge ${update.version}…`);
        await update.downloadAndInstall();
        setNotice('Update installed. Restart LightBridge to finish.');
      }
    } catch (error) {
      setNotice(`Update check failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteAll = async () => {
    setBusy(true);
    try {
      await ipc.deleteAllData();
      setConversationId(null);
      setCapture(null);
      setContextItems([]);
      setNotice('All conversations and captures were deleted.');
      await queryClient.invalidateQueries();
    } catch (error) {
      setNotice(`Deletion failed: ${String(error)}`);
    } finally {
      setBusy(false);
      setConfirmDeleteOpen(false);
    }
  };

  const settings = settingsQuery.data;

  return (
    <Dialog
      isOpen={settingsOpen}
      onOpenChange={setSettingsOpen}
      purpose="info"
      width={460}
      maxHeight="90vh">
      <DialogHeader
        title="LightBridge Settings"
        subtitle="AI quality, capture, privacy, and local data"
        onOpenChange={setSettingsOpen}
      />
      <Section variant="transparent">
        <VStack gap={4}>
          <VStack gap={2}>
            <Text type="label" weight="semibold">
              OpenAI API key
            </Text>
            <Text type="supporting" color="secondary">
              {apiKeyQuery.data === true
                ? 'A key is stored securely in Windows Credential Manager.'
                : 'Chat stays disabled until you add a key.'}
            </Text>
            <HStack gap={2} vAlign="center">
              <TextInput
                label="API key"
                type="password"
                value={keyDraft}
                onChange={setKeyDraft}
                placeholder="sk-…"
                isLabelHidden
              />
              <Button
                label="Save"
                variant="primary"
                size="sm"
                isDisabled={busy || keyDraft.trim().length === 0}
                onClick={() => void saveKey()}
              />
              {apiKeyQuery.data === true && (
                <Button
                  label="Remove"
                  variant="ghost"
                  size="sm"
                  isDisabled={busy}
                  onClick={() => void clearKey()}
                />
              )}
            </HStack>
          </VStack>

          <Selector
            label="Default answer quality"
            description="Each saved message records the exact model used."
            value={settings?.aiProfile ?? 'best'}
            options={PROFILE_OPTIONS}
            isDisabled={busy || settings == null}
            onChange={(value) => {
              const profile = value as AiProfile;
              setProfile(profile);
              setBusy(true);
              void ipc
                .setAiProfile(profile)
                .then(refresh)
                .catch((error) => setNotice(String(error)))
                .finally(() => setBusy(false));
            }}
          />

          <VStack gap={2}>
            <Text type="label" weight="semibold">
              Global shortcut
            </Text>
            <Text type="supporting" color="secondary">
              A conflicting shortcut is rejected and the previous shortcut
              remains active.
            </Text>
            <HStack gap={2}>
              <TextInput
                label="Global shortcut"
                value={shortcutDraft}
                onChange={setShortcutDraft}
                placeholder="Ctrl+Shift+Space"
                isLabelHidden
              />
              <Button
                label="Apply"
                variant="secondary"
                size="sm"
                isDisabled={
                  busy ||
                  shortcutDraft.trim().length === 0 ||
                  shortcutDraft === settings?.shortcut
                }
                onClick={() => void saveShortcut()}
              />
            </HStack>
            <Text type="supporting" color="secondary">
              Esc hides the overlay. Ctrl+E toggles the expanded view.
            </Text>
          </VStack>

          <Selector
            label="Capture retention"
            description="Expired screenshots and OCR are deleted locally."
            value={String(settings?.captureRetentionDays ?? 30)}
            options={RETENTION_OPTIONS}
            isDisabled={busy || settings == null}
            onChange={(value) => {
              setBusy(true);
              void ipc
                .setCaptureRetention(Number(value))
                .then(refresh)
                .catch((error) => setNotice(String(error)))
                .finally(() => setBusy(false));
            }}
          />

          <VStack gap={2}>
            <Text type="label" weight="semibold">
              Data and diagnostics
            </Text>
            <Text type="supporting" color="secondary">
              Captures and OCR stay local until Send. Redacted diagnostics
              exclude credentials and captured or conversational content.
            </Text>
            <HStack gap={2} wrap="wrap">
              <Button
                label="Check for updates"
                variant="secondary"
                size="sm"
                isDisabled={busy}
                onClick={() => void checkForUpdates()}
              />
              <Button
                label="Export data"
                variant="secondary"
                size="sm"
                isDisabled={busy}
                onClick={() => void exportData()}
              />
              <Button
                label="Export diagnostics"
                variant="secondary"
                size="sm"
                isDisabled={busy}
                onClick={() => void exportDiagnostics()}
              />
              <Button
                label="Delete all data"
                variant="destructive"
                size="sm"
                isDisabled={busy}
                onClick={() => setConfirmDeleteOpen(true)}
              />
            </HStack>
          </VStack>

          {notice != null && (
            <Text type="supporting" color="secondary">
              {notice}
            </Text>
          )}
        </VStack>
      </Section>
      <AlertDialog
        isOpen={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete all local data?"
        description="Conversations, messages, captures, and OCR stored on this machine will be permanently removed. Settings and the API key remain."
        actionLabel="Delete all data"
        isActionLoading={busy}
        onAction={() => void deleteAll()}
      />
    </Dialog>
  );
}
