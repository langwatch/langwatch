package domain

// Friendly words for per-worktree slugs (happy-tiger, brave-otter-cove). 60 x 60
// = 3600 two-word combos; the place word is appended only on a collision.

var adjectives = []string{
	"amber", "brave", "bright", "calm", "clever", "cosmic", "crisp", "daring",
	"eager", "electric", "fair", "fancy", "fleet", "gentle", "giddy", "golden",
	"happy", "hardy", "honest", "ivory", "jolly", "keen", "kind", "lively",
	"lucky", "lunar", "merry", "mighty", "nimble", "noble", "polar", "prime",
	"proud", "quick", "quiet", "royal", "rustic", "sage", "scarlet", "sharp",
	"shiny", "silent", "silver", "smooth", "snappy", "solar", "spry", "steady",
	"sunny", "swift", "tidy", "tranquil", "trusty", "vivid", "warm", "witty",
	"wise", "zesty", "zippy", "azure",
}

var animals = []string{
	"otter", "tiger", "falcon", "panda", "lynx", "heron", "moose", "koala",
	"gecko", "raven", "bison", "cobra", "dingo", "ferret", "gopher", "hawk",
	"ibis", "jaguar", "kestrel", "lemur", "marmot", "narwhal", "ocelot", "puffin",
	"quokka", "robin", "salmon", "tapir", "urchin", "viper", "walrus", "yak",
	"zebra", "badger", "beetle", "camel", "dolphin", "eagle", "finch", "gibbon",
	"hyena", "iguana", "jackal", "kiwi", "llama", "manta", "newt", "osprey",
	"pelican", "quail", "rhino", "seal", "toucan", "wombat", "wolf", "swan",
	"crane", "bream", "mantis", "shrike",
}

var places = []string{
	"cloud", "cove", "creek", "delta", "dune", "fjord", "forest", "glade",
	"grove", "harbor", "hollow", "isle", "meadow", "mesa", "peak", "reef",
	"ridge", "shore", "vale", "vista",
}
