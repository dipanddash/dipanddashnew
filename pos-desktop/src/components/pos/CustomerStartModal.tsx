import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  VStack
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import type { CustomerRecord } from "@/types/pos";

type CustomerStartModalProps = {
  isOpen: boolean;
  onClose: () => void;
  orderTypeLabel: string;
  onSearchCustomers: (query: string) => Promise<CustomerRecord[]>;
  onFindByPhone: (phone: string) => Promise<CustomerRecord | null>;
  onCreateCustomer: (input: { name: string; phone: string }) => Promise<CustomerRecord>;
  onSelectCustomer: (customer: CustomerRecord) => void;
};

const normalizePhone = (value: string) => value.replace(/[^\d+]/g, "");

export const CustomerStartModal = ({
  isOpen,
  onClose,
  orderTypeLabel,
  onSearchCustomers,
  onFindByPhone,
  onCreateCustomer,
  onSelectCustomer
}: CustomerStartModalProps) => {
  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizedPhone = useMemo(() => normalizePhone(phone), [phone]);
  const exactMatch = useMemo(
    () => searchResults.find((entry) => normalizePhone(entry.phone) === normalizedPhone) ?? null,
    [normalizedPhone, searchResults]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setPhone("");
    setCustomerName("");
    setSearchResults([]);
    setIsSearching(false);
    setIsSubmitting(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const query = normalizedPhone.trim();
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        setIsSearching(true);
        try {
          const results = await onSearchCustomers(query);
          setSearchResults(results);
        } finally {
          setIsSearching(false);
        }
      })();
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, normalizedPhone, onSearchCustomers]);

  const canCreate = normalizedPhone.length >= 8 && customerName.trim().length >= 2;

  const handleStart = async () => {
    if (!normalizedPhone) {
      return;
    }

    setIsSubmitting(true);
    try {
      const matched = exactMatch ?? (await onFindByPhone(normalizedPhone));
      if (matched) {
        onSelectCustomer(matched);
        return;
      }
      if (!canCreate) {
        return;
      }
      const created = await onCreateCustomer({
        name: customerName.trim(),
        phone: normalizedPhone
      });
      onSelectCustomer(created);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered closeOnOverlayClick={false} closeOnEsc={true}>
      <ModalOverlay />
      <ModalContent borderRadius="16px">
        <ModalHeader>Start {orderTypeLabel} Order</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="stretch" spacing={3}>
            <Text fontSize="sm" color="#6F5A50">
              Enter customer phone number. If customer exists, select and continue. If not found, add name and start.
            </Text>

            <FormControl>
              <FormLabel mb={1}>Customer Phone Number</FormLabel>
              <Input
                id="customer-phone-input"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Enter phone number"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleStart();
                  }
                }}
              />
            </FormControl>

            {isSearching ? (
              <Text fontSize="sm" color="#6F5A50">
                Searching customer...
              </Text>
            ) : null}

            {searchResults.length ? (
              <VStack align="stretch" spacing={2} maxH="220px" overflowY="auto" pr={1}>
                {searchResults.map((customer) => (
                  <HStack
                    key={customer.localId}
                    justify="space-between"
                    p={2.5}
                    borderRadius="10px"
                    border="1px solid"
                    borderColor="rgba(132, 79, 52, 0.18)"
                  >
                    <VStack align="start" spacing={0}>
                      <Text fontWeight={700}>{customer.name}</Text>
                      <Text fontSize="sm" color="#6F5A50">
                        {customer.phone}
                      </Text>
                    </VStack>
                    <Button size="sm" onClick={() => onSelectCustomer(customer)}>
                      Use
                    </Button>
                  </HStack>
                ))}
              </VStack>
            ) : null}

            {!exactMatch ? (
              <Box borderTop="1px dashed" borderColor="rgba(132, 79, 52, 0.2)" pt={3}>
                <FormControl>
                  <FormLabel mb={1}>New Customer Name</FormLabel>
                  <Input
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="Enter customer name"
                  />
                </FormControl>
              </Box>
            ) : null}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" mr={2} onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => void handleStart()}
            isLoading={isSubmitting}
            isDisabled={!normalizedPhone || (!exactMatch && !canCreate)}
          >
            {exactMatch ? "Start Order" : "Create & Start"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
