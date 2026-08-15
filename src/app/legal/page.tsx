import React from 'react';
import {
  FORK_HOST,
  FORK_NAME,
  FORK_SOURCE_URL,
  UPSTREAM_SOURCE_URL,
} from '@/app/forkMetadata';

const LegalPage = () => (
  <main className="max-w-4xl mx-auto my-6 px-4 text-sm text-body-800 dark:text-gray-100">
    <h1 className="font-serif text-3xl font-bold mb-4">{FORK_NAME}</h1>

    <section className="mb-6">
      <h2 className="font-serif text-xl font-bold mb-2">Attribution</h2>
      <p className="mb-2">
        This site is an unofficial modified fork of the
        {' '}
        <a href={UPSTREAM_SOURCE_URL} target="_blank">OSRS Wiki DPS Calculator</a>
        , originally created for the
        {' '}
        <a href="https://oldschool.runescape.wiki" target="_blank">Old School RuneScape Wiki</a>
        {' '}
        by Weird Gloop and community contributors.
      </p>
      <p>
        The calculator uses material and game data derived from the OSRS Wiki, including item,
        monster, spell, and combat information contributed by OSRS Wiki editors.
      </p>
    </section>

    <section className="mb-6">
      <h2 className="font-serif text-xl font-bold mb-2">Source Code License</h2>
      <p className="mb-2">
        The calculator source code is distributed under the GNU General Public License version 3.
        The modified source for this fork is available at
        {' '}
        <a href={FORK_SOURCE_URL} target="_blank">{FORK_SOURCE_URL}</a>
        .
      </p>
      <p>
        Changes made for
        {' '}
        {FORK_HOST}
        {' '}
        remain licensed under GPLv3.
      </p>
    </section>

    <section className="mb-6">
      <h2 className="font-serif text-xl font-bold mb-2">Wiki Content License</h2>
      <p>
        OSRS Wiki content is licensed under the Creative Commons
        Attribution-NonCommercial-ShareAlike 3.0 Unported License, except where otherwise noted.
        Reuse of wiki-derived content on this site is intended to preserve attribution and the
        same non-commercial, share-alike terms.
      </p>
    </section>

    <section>
      <h2 className="font-serif text-xl font-bold mb-2">Non-Affiliation</h2>
      <p>
        This site is unofficial and is not affiliated with, sponsored by, or endorsed by Jagex,
        Weird Gloop, or the OSRS Wiki. RuneScape and Old School RuneScape are trademarks of Jagex
        Limited.
      </p>
    </section>
  </main>
);

export default LegalPage;
