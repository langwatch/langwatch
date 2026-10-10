Feature: The no-raw-font-size lint rule
  Text in module browser code is sized by a named product text style from the
  design system (`textStyle="bodySm"`, `caption`, `label`...), never by a pixel,
  em or rem literal or a bare number. Where an API takes a number (chart ticks,
  editor options) the value comes from `TYPE_SCALE_PX`; block-glyph art uses
  `GLYPH_ART_PX`.

  @unit
  Scenario: A raw font size on a JSX prop is reported
    Given module browser code whose fontSize or textStyle prop is a px, em or rem literal or a number
    When the no-raw-font-size rule runs over it
    Then it reports rawFontSize for every literal the prop can resolve to

  @unit
  Scenario: A raw font size in a style object is reported
    Given module browser code whose style object sets fontSize to a px literal or a number
    When the no-raw-font-size rule runs over it
    Then it reports rawFontSize

  @unit
  Scenario: A text style or a size token is accepted
    Given module browser code that sizes text with a textStyle name, a size token or TYPE_SCALE_PX
    When the no-raw-font-size rule runs over it
    Then it reports nothing
