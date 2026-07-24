import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { VStack, HStack } from '@astryxdesign/core/Layout';
import { Section } from '@astryxdesign/core/Section';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';

import { ipc } from '../lib/ipc';
import { useEntryTransition } from '../lib/useEntryTransition';
import { useAppStore } from '../state/appStore';

export function PrivacyDialog() {
  const queryClient = useQueryClient();
  const privacyOpen = useAppStore((state) => state.privacyOpen);
  const setPrivacyOpen = useAppStore((state) => state.setPrivacyOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entryStyle = useEntryTransition('fadeIn', '--duration-medium', privacyOpen);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const settings = await ipc.acknowledgePrivacy();
      queryClient.setQueryData(['settings'], settings);
      setPrivacyOpen(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={privacyOpen}
      onOpenChange={() => undefined}
      purpose="required"
      width={440}>
      <DialogHeader
        title="Your screen stays private until Send"
        subtitle="Review how LightBridge handles captured context"
        startContent={<Icon icon={ShieldCheckIcon} size="md" />}
      />
      <Section variant="transparent">
        <VStack gap={4} style={entryStyle}>
          <Text>
            Screenshots, window details, and OCR are saved locally so you can
            review and reuse them. LightBridge sends only the context items you
            leave selected, and only when you press Send.
          </Text>
          <Text type="supporting" color="secondary">
            Provider credentials are stored in Windows Credential Manager and
            supplied only to the local Bifrost gateway. Diagnostics exclude
            credentials, screenshots, OCR, message text, window titles, and
            process paths.
          </Text>
          {error != null && (
            <Text type="supporting" color="secondary">
              {error}
            </Text>
          )}
          <HStack gap={2} hAlign="end">
            <Button
              label="Open settings"
              variant="secondary"
              isDisabled={busy}
              onClick={() => void ipc.showSettings()}
            />
            <Button
              label="I understand"
              variant="primary"
              isLoading={busy}
              onClick={() => void accept()}
            />
          </HStack>
        </VStack>
      </Section>
    </Dialog>
  );
}
