/**
 * @vitest-environment jsdom
 *
 * Integration tests for InvoicesBlock component.
 *
 * Tests rendering of the invoice table, empty state, loading state,
 * and error state.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoicesBlock } from "../InvoicesBlock";

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------
let mockListInvoicesReturn: {
  data?: Array<{
    id: string;
    number: string | null;
    date: number;
    amountDue: number;
    currency: string;
    status: string;
    pdfUrl: string | null;
    hostedUrl: string | null;
  }>;
  isLoading: boolean;
  isError: boolean;
};

vi.mock("~/utils/api", () => ({
  api: {
    subscription: {
      listInvoices: {
        useQuery: () => mockListInvoicesReturn,
      },
    },
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderInvoicesBlock = () => {
  return render(<InvoicesBlock organizationId="test-org-id" />, {
    wrapper: Wrapper,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("<InvoicesBlock/>", () => {
  beforeEach(() => {
    mockListInvoicesReturn = {
      data: undefined,
      isLoading: false,
      isError: false,
    };
  });

  afterEach(() => {
    cleanup();
  });

  describe("when loading", () => {
    it("displays a loading skeleton", () => {
      mockListInvoicesReturn = {
        data: undefined,
        isLoading: true,
        isError: false,
      };
      renderInvoicesBlock();
      expect(screen.getByTestId("invoices-loading")).toBeInTheDocument();
    });
  });

  describe("when there is an error", () => {
    it("displays an error message", () => {
      mockListInvoicesReturn = {
        data: undefined,
        isLoading: false,
        isError: true,
      };
      renderInvoicesBlock();
      expect(
        screen.getByText(/failed to load invoices/i),
      ).toBeInTheDocument();
    });
  });

  describe("when there are no invoices", () => {
    it("displays empty state message", () => {
      mockListInvoicesReturn = {
        data: [],
        isLoading: false,
        isError: false,
      };
      renderInvoicesBlock();
      expect(screen.getByText(/no invoices yet/i)).toBeInTheDocument();
    });
  });

  describe("when invoices are returned", () => {
    beforeEach(() => {
      mockListInvoicesReturn = {
        data: [
          {
            id: "inv_1",
            number: "INV-001",
            date: 1700000000,
            amountDue: 5000,
            currency: "usd",
            status: "paid",
            pdfUrl: "https://stripe.com/pdf/inv_1",
            hostedUrl: "https://stripe.com/hosted/inv_1",
          },
          {
            id: "inv_2",
            number: "INV-002",
            date: 1700100000,
            amountDue: 7500,
            currency: "usd",
            status: "open",
            pdfUrl: null,
            hostedUrl: "https://stripe.com/hosted/inv_2",
          },
        ],
        isLoading: false,
        isError: false,
      };
    });

    it("renders the heading", () => {
      renderInvoicesBlock();
      expect(screen.getByText("Recent Invoices")).toBeInTheDocument();
    });

    it("renders invoice numbers", () => {
      renderInvoicesBlock();
      expect(screen.getByText("INV-001")).toBeInTheDocument();
      expect(screen.getByText("INV-002")).toBeInTheDocument();
    });

    it("renders formatted dates", () => {
      renderInvoicesBlock();
      // Nov 14, 2023 for timestamp 1700000000
      expect(screen.getByText(/Nov 14, 2023/)).toBeInTheDocument();
    });

    it("renders status badges", () => {
      renderInvoicesBlock();
      expect(screen.getByText("paid")).toBeInTheDocument();
      expect(screen.getByText("open")).toBeInTheDocument();
    });

    it("renders PDF download link for invoices with pdfUrl", () => {
      renderInvoicesBlock();
      const pdfLink = screen.getByTestId("invoice-pdf-inv_1");
      expect(pdfLink).toHaveAttribute("href", "https://stripe.com/pdf/inv_1");
      expect(pdfLink).toHaveAttribute("target", "_blank");
    });

    it("does not render PDF link when pdfUrl is null", () => {
      renderInvoicesBlock();
      expect(
        screen.queryByTestId("invoice-pdf-inv_2"),
      ).not.toBeInTheDocument();
    });
  });
});
