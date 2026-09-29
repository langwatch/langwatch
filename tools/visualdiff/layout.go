package visualdiff

import (
	"fmt"
	"image"
	"image/png"
	"os"
)

// LayoutDiff compares where two screenshots put things, not their colors:
// a pane that collapsed to a strip under a blurred dialog moves few pixels
// past the pixel diff's threshold but most of the page's covered area.
type LayoutDiff struct {
	Measured bool `json:"measured"`
	// Resized is the two screenshots having different sizes: a page that grew or shrank.
	Resized bool `json:"resized"`
	// Shift is the share of the page's blocks whose covered area differs.
	Shift float64 `json:"shift"`
}

// layoutProbe is how the covered area is read: a pixel is covered when it
// differs from its page's dominant color by more than tolerance, and a block
// has moved when more than minPixels of its pixels changed coverage.
type layoutProbe struct {
	tolerance, block, minPixels int
}

var defaultLayoutProbe = layoutProbe{tolerance: 1, block: 16, minPixels: 32}

// LayoutShiftRatio is the share of moved blocks at which a screen is a layout finding.
const LayoutShiftRatio = 0.05

// Changed reports whether the layout differs beyond the threshold.
func (diff LayoutDiff) Changed() bool {
	return diff.Measured && (diff.Resized || diff.Shift >= LayoutShiftRatio)
}

// Why is the layout difference in words.
func (diff LayoutDiff) Why() string {
	if diff.Resized {
		return "the page is a different size"
	}
	return fmt.Sprintf("%.0f%% of the page's covered area moved", diff.Shift*100)
}

// CompareLayout measures two screenshot files; an unreadable one measures nothing.
func CompareLayout(basePath, candidatePath string) LayoutDiff {
	return defaultLayoutProbe.compareFiles(basePath, candidatePath)
}

func (probe layoutProbe) compareFiles(basePath, candidatePath string) LayoutDiff {
	base, err := readPNG(basePath)
	if err != nil {
		return LayoutDiff{}
	}
	candidate, err := readPNG(candidatePath)
	if err != nil {
		return LayoutDiff{}
	}
	return probe.compare(base, candidate)
}

func (probe layoutProbe) compare(base, candidate image.Image) LayoutDiff {
	bounds := base.Bounds()
	if bounds.Size() != candidate.Bounds().Size() {
		return LayoutDiff{Measured: true, Resized: true}
	}
	baseCovered, candidateCovered := probe.covered(base), probe.covered(candidate)
	width, height := bounds.Dx(), bounds.Dy()
	columns, rows := width/probe.block, height/probe.block
	if columns == 0 || rows == 0 {
		return LayoutDiff{Measured: true}
	}
	changed := make([]bool, len(baseCovered))
	for index := range changed {
		changed[index] = baseCovered[index] != candidateCovered[index]
	}
	moved := 0
	for row := range rows {
		for column := range columns {
			if probe.blockMoved(changed, width, image.Pt(column, row)) {
				moved++
			}
		}
	}
	return LayoutDiff{Measured: true, Shift: float64(moved) / float64(columns*rows)}
}

// blockMoved reports whether the block at cell has more than minPixels changed.
func (probe layoutProbe) blockMoved(changed []bool, width int, cell image.Point) bool {
	count := 0
	for y := cell.Y * probe.block; y < (cell.Y+1)*probe.block; y++ {
		for x := cell.X * probe.block; x < (cell.X+1)*probe.block; x++ {
			if changed[y*width+x] {
				count++
			}
		}
	}
	return count > probe.minPixels
}

// covered marks every pixel that differs from the page's dominant color.
func (probe layoutProbe) covered(picture image.Image) []bool {
	pixels := packedPixels(picture)
	counts := map[uint32]int{}
	for _, color := range pixels {
		counts[color]++
	}
	dominant, most := uint32(0), 0
	for color, count := range counts {
		if count > most || (count == most && color < dominant) {
			dominant, most = color, count
		}
	}
	covered := make([]bool, len(pixels))
	for index, color := range pixels {
		covered[index] = channelDistance(color, dominant) > probe.tolerance
	}
	return covered
}

// packedPixels is every pixel as 0xRRGGBB, row by row; the runner's PNGs are
// opaque, so alpha is ignored.
func packedPixels(picture image.Image) []uint32 {
	bounds := picture.Bounds()
	pixels := make([]uint32, 0, bounds.Dx()*bounds.Dy())
	if direct, ok := picture.(*image.NRGBA); ok {
		for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
			for x := bounds.Min.X; x < bounds.Max.X; x++ {
				at := direct.PixOffset(x, y)
				pixels = append(pixels, uint32(direct.Pix[at])<<16|uint32(direct.Pix[at+1])<<8|uint32(direct.Pix[at+2]))
			}
		}
		return pixels
	}
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			red, green, blue, _ := picture.At(x, y).RGBA()
			pixels = append(pixels, red>>8<<16|green>>8<<8|blue>>8)
		}
	}
	return pixels
}

func channelDistance(first, second uint32) int {
	distance := 0
	for shift := 0; shift <= 16; shift += 8 {
		delta := int(first>>shift&0xff) - int(second>>shift&0xff)
		distance = max(distance, delta, -delta)
	}
	return distance
}

func readPNG(path string) (image.Image, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	return png.Decode(file)
}
