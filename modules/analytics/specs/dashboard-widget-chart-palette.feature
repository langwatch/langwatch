Feature: Widget code draws in the chart palette for the reader's mode

  One palette and one style set serve every chart. Widget code reads them from the runtime
  as LW.palette and LW.chartStyle, so light and dark both read well with no colour copied in.

  Rule: The runtime resolves the palette for the current mode

    @unit
    Scenario: Light mode gives the ordered series colours of the light tokens
      Given the host resolves the chart series tokens for light mode
      When the runtime builds LW.palette
      Then LW.palette has mode "light" and its eight series colours in token order

    @unit
    Scenario: Dark mode gives the dark series colours, not the light ones
      Given the host resolves the chart series tokens for dark mode
      When the runtime builds LW.palette
      Then LW.palette has mode "dark" and each series colour is the dark value

    @unit
    Scenario: The style set carries the shape metrics and the track, axis and grid greys
      Given the host resolves the style tokens for light mode
      When the runtime builds LW.chartStyle
      Then LW.chartStyle has barCornerRadius, dotSize, and the track, axis and grid colours

  Rule: Widget code with a hard-coded colour gets a hint, never a refusal

    @unit
    Scenario: A quoted hex colour is hinted
      Given widget code with a quoted hex colour
      When the editor checks the source
      Then the hex is hinted to use LW.palette and no error is raised

    @unit
    Scenario: Source that reads LW.palette gets no colour hint
      Given widget code that reads only LW.palette and LW.chartStyle
      When the editor checks the source
      Then no colour hint is raised

    @unit
    Scenario: A hex colour inside a longer string is hinted
      Given widget code with a hex colour inside a longer string
      When the editor checks the source
      Then the hex is hinted and the text around it is not

    @unit
    Scenario: Hex colours in comments are not hinted
      Given widget code with a hex colour in a comment
      When the editor checks the source
      Then no colour hint is raised

    @unit
    Scenario: The shipped widget code raises no colour hint
      Given every widget the catalogue ships
      When the editor checks each widget's source
      Then no colour hint is raised for any of them

    @unit
    Scenario: A colour function inside a string is hinted
      Given widget code with "rgb(0, 0, 0)" and "hsl(0 0% 0%)" in string literals
      When the editor checks the source
      Then a colour hint is raised for each function call

    @unit
    Scenario: A white or black colour in a string is hinted
      Given widget code with "white" and "1px solid black" in string literals
      When the editor checks the source
      Then a colour hint is raised for each named colour

    @unit
    Scenario: Text that merely contains white or black is not hinted
      Given widget code with "Black box" and "a white space" in string literals
      When the editor checks the source
      Then no colour hint is raised
