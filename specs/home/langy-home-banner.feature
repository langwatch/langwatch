Feature: Langy home banner

  The home-page announcement carousel gains a Langy slide, in one of two
  forms depending on what the user has:

  - Users WITH Langy (the same gate that shows the Langy panel: team
    membership plus staff bypass or the release_langy_enabled flag) see an
    activation banner: Langy introduced in its own visual identity, with a
    call to action that opens the Langy panel right there on the page.
  - Users WITHOUT Langy but inside the promo audience
    (release_langy_promo_enabled) see a teaser banner announcing Langy is
    coming, linking out to the marketing site.

  Having Langy always wins: a user in both audiences sees only the
  activation banner. Users in neither audience see no Langy slide at all.

  While either Langy slide is live, the voice agents slide keeps its spot
  in the carousel but stops claiming the "New" pill — the Langy
  announcement is the new thing now.

  Background:
    Given a logged-in user with a selected project

  Scenario: No Langy slide for users in neither audience
    Given the user does not have Langy
    And the user is not in the Langy promo audience
    When the home page loads
    Then no Langy banner is present in the carousel
    And the voice agents banner still shows its "New" pill

  Scenario: Promo audience without Langy sees the teaser banner
    Given the user does not have Langy
    And the user is in the Langy promo audience
    When the home page loads
    Then a Langy banner with the heading "Langy is on its way" is present
    And the banner shows a "Coming soon" pill
    And the banner shows a "Learn more" call to action
    And the voice agents banner is still present
    And the voice agents banner shows no "New" pill

  Scenario: Teaser CTA opens the marketing site
    Given the Langy teaser banner is visible
    When the user clicks the "Learn more" CTA
    Then a new browser tab opens on the LangWatch marketing site
    And a "langy_promo_banner_click" PostHog event is captured with surface "home_banner"

  Scenario: Users with Langy see the activation banner
    Given the user has Langy
    When the home page loads
    Then a Langy banner with the heading "Meet Langy" is present
    And the banner shows a "New" pill
    And the banner shows an "Open Langy" call to action
    And the voice agents banner shows no "New" pill

  Scenario: Having Langy wins over the promo audience
    Given the user has Langy
    And the user is in the Langy promo audience
    When the home page loads
    Then exactly one Langy banner is present
    And it is the activation banner, not the teaser

  Scenario: Activation CTA hands off into the Langy panel
    Given the Langy activation banner is visible
    When the user clicks "Open Langy"
    Then the Langy panel opens on the same page, with no navigation
    And a "langy_activation" PostHog event is captured with surface "home_banner"
    And the Langy banner is snoozed, handing the carousel slot to the next slide

  Scenario: The banner demonstrates what Langy can do
    Given a Langy banner is visible
    Then it shows example asks matching what the Langy panel itself suggests
    And the asks change one calm crossfade at a time, never typed out character by character
    And under prefers-reduced-motion a single example is shown statically, without animation

  Scenario: The Langy banner wears the panel's identity, inverted against the app theme
    Given a Langy banner is visible
    Then its background is the carousel's one shared animated gradient, tuned for this slide only — nothing layered over it
    And the gradient holds a calm surface-tone field under the copy, gathering the brand colour toward the right like a fold
    And in the app's dark theme it shows the paper view: cream field, ink serif heading
    And in the app's light theme it shows the ink view: near-black field, paper text, brand and grey hairlines

  Scenario: The ink view carries the panel's signal grid
    Given a Langy banner is visible
    And the app is in its light theme, so the banner shows the ink view
    Then the faint signal grid the Langy panel wears on ink textures the banner's field
    And the grid stays a whisper, never competing with the copy
    And the paper view shows no grid
    And the slide dissolves into its neighbours as one continuous gradient

  Scenario: The Langy slide shines through the page's glass cards
    Given a Langy banner is visible
    Then the slide's own animated gradient shows through the page's glass cards — and nowhere else on the page
    And it warms up gradually after the slide arrives, like the page presenting Langy
    And it dims away on the slide change's own clock when the carousel moves on
    And no other slide casts this shine

  Scenario: The activation button carries the keyboard shortcut
    Given the Langy activation banner is visible
    Then the "Open Langy" call to action shows the shortcut that toggles Langy inside the button

  Scenario: Each Langy banner owns its own per-project snooze
    Given the user dismissed the Langy teaser banner while in the promo audience
    When the user is later given Langy itself
    Then the activation banner still appears, unaffected by the teaser's snooze
