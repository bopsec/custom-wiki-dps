import React, { PropsWithChildren } from 'react';
import 'react-toastify/dist/ReactToastify.css';
import '@xyflow/react/dist/style.css';
import '../globals.css';
import { Metadata } from 'next';
import { ibm, pts } from '@/fonts';
import ClientProviders from '@/app/components/ClientProviders';
import {
  FORK_HOST,
  FORK_NAME,
  FORK_URL,
  UPSTREAM_SOURCE_URL,
} from '@/app/forkMetadata';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || FORK_URL),
  title: `${FORK_NAME} - OSRS`,
  description: 'Advanced fork of the OSRS Wiki damage-per-second calculator for Old School RuneScape.',
  authors: [
    { name: 'Bopsec', url: FORK_URL },
    { name: 'OSRS Wiki contributors', url: UPSTREAM_SOURCE_URL },
  ],
  keywords: ['osrs', 'old school runescape', 'runescape', 'dps calculator', 'osrs dps', FORK_HOST],
  alternates: { canonical: `${process.env.NEXT_PUBLIC_BASE_URL || FORK_URL}${process.env.NEXT_PUBLIC_BASE_PATH || ''}` },
  twitter: {
    card: 'summary',
  },
};

const RootLayout: React.FC<PropsWithChildren> = (props) => {
  const { children } = props;

  return (
  // We are suppressing hydration warnings here so that react-themes works correctly.
  // See https://github.com/pacocoursey/next-themes/issues/152#issuecomment-1364280564
    <html suppressHydrationWarning lang="en" className={`${pts.variable} ${ibm.variable}`}>
      <body>
        <ClientProviders>
          {children}
        </ClientProviders>
      </body>
    </html>
  );
};

export default RootLayout;
