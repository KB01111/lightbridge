import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { Section } from '@astryxdesign/core/Section';
import { List, ListItem } from '@astryxdesign/core/List';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import {
  MagnifyingGlassIcon,
  DocumentTextIcon,
  ChatBubbleLeftIcon,
} from '@heroicons/react/24/outline';

import { ipc, type MemoryHit } from '../lib/ipc';
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState('');

  const apiKeyQuery = useQuery({
    queryKey: ['hasApiKey'],
    queryFn: () => ipc.hasApiKey(),
  });

  const memoryQueryResult = useQuery({
    queryKey: ['searchMemory', memoryQuery],
    queryFn: () => ipc.searchMemory(memoryQuery.trim(), 20),
    enabled: memoryQuery.trim().length > 1,
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
      setConfirmDeleteOpen(false);
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
              Search memory
            </Text>
            <Text type="supporting" color="secondary">
              Full-text search across past OCR captures and chat messages
              stored on this machine.
            </Text>
            <TextInput
              label="Search memory"
              value={memoryQuery}
              onChange={setMemoryQuery}
              placeholder="Search captures and messages..."
              startIcon={MagnifyingGlassIcon}
              hasClear
              isLabelHidden
            />
            {memoryQuery.trim().length > 1 &&
              (!memoryQueryResult.isPending &&
              !memoryQueryResult.isError &&
              (memoryQueryResult.data == null ||
              memoryQueryResult.data.length === 0) ? (
                <EmptyState
                  title="No matches"
                  description="Try a different search term."
                  isCompact
                />
              ) : (
                <List density="compact" hasDividers>
                  {memoryQueryResult.data?.map((hit: MemoryHit) => (
                    <ListItem
                      key={`${hit.kind}:${hit.refId}`}
                      label={hit.snippet}
                      description={
                        <Timestamp value={hit.createdAt} format="auto" />
                      }
                      startContent={
                        <Icon
                          icon={
                            hit.kind === 'message'
                              ? ChatBubbleLeftIcon
                              : DocumentTextIcon
                          }
                          size="sm"
                        />
                      }
                    />
                  ))}
                </List>
              ))}
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
        description="Conversations, captures, and OCR text stored on this machine will be permanently removed. This cannot be undone."
        actionLabel="Delete all data"
        isActionLoading={busy}
        onAction={() => void deleteAll()}
      />
    </Dialog>
  );
}
