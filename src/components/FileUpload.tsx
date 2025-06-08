import { useState, useCallback } from "react";
import { Upload, FileSpreadsheet, AlertCircle } from "lucide-react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface FundraiseData {
  id: string;
  company_name: string;
  date_raised: string;
  amount_raised: string;
  investors: string;
  status: "pending" | "processing" | "completed" | "error";
}

const normalizeColumnName = (name: string): string => {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
};

const formatDate = (dateValue: string | number): string => {
  // Handle Excel date number format
  if (!isNaN(Number(dateValue))) {
    const excelDate = new Date((Number(dateValue) - 25569) * 86400 * 1000);
    if (!isNaN(excelDate.getTime())) {
      return excelDate.toISOString().split('T')[0]; // Returns YYYY-MM-DD
    }
  }
  
  // Try parsing as regular date string
  const date = new Date(dateValue);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  
  // If all parsing fails, return the original value
  return String(dateValue);
};

const findColumnValue = (row: unknown, possibleNames: string[]): string => {
  // First try exact matches
  for (const name of possibleNames) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
      return String(row[name]).trim();
    }
  }

  // Then try normalized matches
  const rowKeys = Object.keys(row);
  for (const name of possibleNames) {
    const normalizedTarget = normalizeColumnName(name);
    for (const key of rowKeys) {
      if (
        normalizeColumnName(key) === normalizedTarget &&
        row[key] !== undefined &&
        row[key] !== null &&
        row[key] !== ""
      ) {
        return String(row[key]).trim();
      }
    }
  }

  return "";
};

interface FileUploadProps {
  onFileUpload: (data: FundraiseData[]) => void;
}

export const FileUpload = ({ onFileUpload }: FileUploadProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const processFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      const fileExtension = file.name.split(".").pop()?.toLowerCase();

      try {
        let rawData: unknown[] = [];

        if (fileExtension === "csv") {
          await new Promise((resolve, reject) => {
            Papa.parse(file, {
              header: true,
              complete: (results) => {
                rawData = results.data;
                resolve(rawData);
              },
              error: (error) => {
                reject(new Error(`CSV parsing error: ${error.message}`));
              },
            });
          });
        } else if (fileExtension === "xlsx" || fileExtension === "xls") {
          const arrayBuffer = await file.arrayBuffer();
          const data = new Uint8Array(arrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          rawData = XLSX.utils.sheet_to_json(worksheet);
        } else {
          throw new Error(
            "Unsupported file type. Please upload a CSV or XLSX file."
          );
        }

        console.log("Raw data from file:", rawData);
        console.log(
          "First row keys:",
          rawData.length > 0 ? Object.keys(rawData[0]) : "No data"
        );

        if (!rawData || rawData.length === 0) {
          throw new Error(
            "The file appears to be empty or contains no data rows."
          );
        }

        // Define possible column name variations - Updated with your new column names
        const companyNameVariations = [
          "company_name",
          "Company Name",
          "company name",
          "Company",
          "company",
          "name",
          "Name",
          "Organization Name",
          "organization name",
          "organization",
          "Organization",
        ];
        const dateRaisedVariations = [
          "date_raised",
          "Date Raised",
          "date raised",
          "Date",
          "date",
          "funding date",
          "Funding Date",
          "Announced Date",
          "announced date",
          "announcement date",
          "Announcement Date",
        ];
        const amountRaisedVariations = [
          "amount_raised",
          "Amount Raised",
          "amount raised",
          "Amount",
          "amount",
          "funding amount",
          "Funding Amount",
          "raised",
          "Raised",
        ];
        const investorsVariations = [
          "investors",
          "Investors",
          "investor",
          "Investor",
          "vc",
          "VC",
          "fund",
          "Fund",
          "Lead Investors",
          "lead investors",
          "lead investor",
          "Lead Investor",
        ];

        const processedData: FundraiseData[] = [];

        for (let i = 0; i < rawData.length; i++) {
          const row = rawData[i];

          const companyName = findColumnValue(row, companyNameVariations);
          const dateRaised = findColumnValue(row, dateRaisedVariations);
          const amountRaised = findColumnValue(row, amountRaisedVariations);
          const investors = findColumnValue(row, investorsVariations);

          // Only include rows that have at least a company name
          if (companyName) {
            processedData.push({
              company_name: companyName,
              date_raised: dateRaised ? formatDate(dateRaised) : "Not specified",
              amount_raised: amountRaised || "Not specified",
              investors: investors || "Not specified",
              status: "pending" as const,
              id: i.toString(),
            });
          }
        }

        console.log("Processed data:", processedData);

        if (processedData.length === 0) {
          const availableColumns =
            rawData.length > 0 ? Object.keys(rawData[0]).join(", ") : "None";
          throw new Error(
            `No valid data found. Make sure your file has a column for company names. Available columns: ${availableColumns}`
          );
        }

        onFileUpload(processedData);
        toast({
          title: "File uploaded successfully!",
          description: `Processed and saved ${processedData.length} records to database`,
        });
      } catch (error) {
        console.error("File processing error:", error);
        toast({
          title: "Error processing file",
          description:
            error instanceof Error
              ? error.message
              : "Please check your file format and try again",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [onFileUpload, toast]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const file = files[0];

    if (file) {
      processFile(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div
        className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all duration-300 backdrop-blur-sm ${
          isDragging
            ? "border-blue-400 bg-blue-500/10"
            : "border-gray-600 bg-black/20 hover:border-blue-500 hover:bg-blue-500/5"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isProcessing ? (
          <div className="space-y-4">
            <div className="animate-spin mx-auto h-12 w-12 border-4 border-blue-400 border-t-transparent rounded-full"></div>
            <p className="text-gray-300">Processing and saving your file...</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="relative">
                <Upload className="h-16 w-16 text-blue-400 mx-auto animate-bounce" />
                <FileSpreadsheet className="h-8 w-8 text-green-400 absolute -bottom-2 -right-2" />
              </div>
            </div>

            <div>
              <h3 className="text-2xl font-semibold text-white mb-2">
                Upload Your Fundraise Data
              </h3>
              <p className="text-gray-300 mb-4">
                Drag and drop your CSV or XLSX file here, or click to browse
              </p>

              <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-6">
                <AlertCircle className="h-4 w-4" />
                <span>Supports CSV and XLSX files</span>
              </div>
            </div>

            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileInput}
              className="hidden"
              id="file-upload"
            />

            <Button
              asChild
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0"
            >
              <label htmlFor="file-upload" className="cursor-pointer">
                Choose File
              </label>
            </Button>
          </div>
        )}
      </div>

      <div className="mt-8 bg-black/20 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
        <h4 className="text-lg font-semibold text-white mb-3">
          Expected CSV/XLSX Format:
        </h4>
        <div className="text-sm text-gray-300 space-y-2">
          <p>
            <strong>Required columns (flexible naming):</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              <strong>Company Name:</strong> "Company Name", "Organization
              Name", "company_name", "Company", or "Name"
            </li>
            <li>
              <strong>Date Raised:</strong> "Date Raised", "Announced Date",
              "date_raised", "Date", or "Funding Date"
            </li>
            <li>
              <strong>Amount Raised:</strong> "Amount Raised", "amount_raised",
              "Amount", or "Funding Amount"
            </li>
            <li>
              <strong>Investors:</strong> "Investors", "Lead Investors",
              "investors", "Investor", "VC", or "Fund"
            </li>
          </ul>
          <p className="text-xs text-gray-400 mt-3">
            <strong>Note:</strong> Only Company Name (or Organization Name) is
            required. Other fields will default to "Not specified" if missing.
          </p>
        </div>
      </div>
    </div>
  );
};
