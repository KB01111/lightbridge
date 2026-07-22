import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { Section } from '@astryxdesign/core/Section';

import { ipc } from '../lib/ipc';
import { useAppStore } from '../state/appStore';

// Settings: the API key is write-only. It is sent once to the Rust host,
// stored in Windows Credential Manager, and never read back into the webview.
export function SettingsDialog() {
  const queryClient = useQueryClient();
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const apiKeyQuery = useQuery({
    queryKey: ['hasApiKey'],
    queryFn: () => ipc.hasApiKey(),
  });

  const saveKey = async () => {
    if (keyDraft.trim().length === 0) return;
    setBusy(true);
    try {
      await ipc.setApiKey(keyDraft.trim());
      setKeyDraft('');
      setNotice('API key stored in Windows Credential Manager.');
      await queryClient.invalidateQueries({ queryKey: ['hasApiKey'] });
    } catch (err) {
      setNotice(`Failed to store key: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setBusy(true);
    try {
      await ipc.clearApiKey();
      setNotice('API key removed.');
      await queryClient.invalidateQueries({ queryKey: ['hasApiKey'] });
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    setBusy(true);
    try {
      const path = await ipc.exportData();
      setNotice(`Data exported to ${path}`);
    } catch (err) {
      setNotice(`Export failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteAll = async () => {
    setBusy(true);
    try {
      await ipc.deleteAllData();
      setNotice('All local data deleted.');
      await queryClient.invalidateQueries();
    } catch (err) {
      setNotice(`Deletion failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={settingsOpen} onOpenChange={setSettingsOpen} purpose="info">
      <DialogHeader
        title="LightBridge Settings"
        subtitle="Keys, shortcuts, and local data"
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
                : 'No key stored yet. Chat is disabled until a key is added.'}
            </Text>
            <HStack gap={2} vAlign="center">
              <TextInput
                label="API key"
                type="password"
                value={keyDraft}
                onChange={setKeyDraft}
                placeholder="sk-..."
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

          <VStack gap={2}>
            <Text type="label" weight="semibold">
              Global shortcut
            </Text>
            <Text type="supporting" color="secondary">
              Ctrl+Shift+Space opens LightBridge over the active window. Esc
              hides it. Ctrl+E toggles the expanded view.
            </Text>
          </VStack>

          <VStack gap={2}>
            <Text type="label" weight="semibold">
              Local data
            </Text>
            <Text type="supporting" color="secondary">
              Conversations, captures, and OCR text are stored only on this
              machine in the LightBridge app-data folder.
            </Text>
            <HStack gap={2}>
              <Button
                label="Export data"
                variant="secondary"
                size="sm"
                isDisabled={busy}
                onClick={() => void exportData()}
              />
              <Button
                label="Delete all data"
                variant="destructive"
                size="sm"
                isDisabled={busy}
                onClick={() => void deleteAll()}
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
    </Dialog>
  );
}
