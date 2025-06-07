// Hello 
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Eye, Download } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface FundraiseData {
  id: string;
  company_name: string;
  date_raised: string;
  amount_raised: string;
  investors: string;
  press_url_1?: string;
  press_url_2?: string;
  press_url_3?: string;
  investor_contacts?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

interface DataTableProps {
  data: FundraiseData[];
}

export const DataTable = ({ data }: DataTableProps) => {
  const getStatusBadge = (status: string) => {
    const variants = {
      pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      processing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      completed: "bg-green-500/20 text-green-400 border-green-500/30",
      error: "bg-red-500/20 text-red-400 border-red-500/30",
    };

    return (
      <Badge className={`${variants[status as keyof typeof variants]} border`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const renderPressUrl = (url: string | undefined, index: number) => {
    if (!url || url === 'N/A') {
      return <span className="text-gray-500 text-xs">N/A</span>;
    }
    
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1"
      >
        <ExternalLink className="h-3 w-3" />
        Link {index}
      </a>
    );
  };

  const exportToCSV = () => {
    const headers = [
      'Company Name',
      'Date Raised',
      'Amount Raised',
      'Investors',
      'Press URL 1',
      'Press URL 2',
      'Press URL 3',
      'Investor Contacts',
      'Status'
    ];

    const csvContent = [
      headers.join(','),
      ...data.map(row => [
        row.company_name,
        row.date_raised,
        row.amount_raised,
        row.investors,
        row.press_url_1 || '',
        row.press_url_2 || '',
        row.press_url_3 || '',
        row.investor_contacts || '',
        row.status
      ].map(field => `"${field}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'space_fundraises_enriched.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-black/20 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Fundraise Data</h2>
        <Button
          onClick={exportToCSV}
          className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white border-0"
        >
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-700">
              <TableHead className="text-gray-300 min-w-[150px]">Company</TableHead>
              <TableHead className="text-gray-300">Date</TableHead>
              <TableHead className="text-gray-300">Amount</TableHead>
              <TableHead className="text-gray-300 min-w-[150px]">Investors</TableHead>
              <TableHead className="text-gray-300">Press URL 1</TableHead>
              <TableHead className="text-gray-300">Press URL 2</TableHead>
              <TableHead className="text-gray-300">Press URL 3</TableHead>
              <TableHead className="text-gray-300 min-w-[200px]">Investor Names</TableHead>
              <TableHead className="text-gray-300">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.id} className="border-gray-700 hover:bg-gray-800/30">
                <TableCell className="font-medium text-white">
                  {row.company_name}
                </TableCell>
                <TableCell className="text-gray-300">{row.date_raised}</TableCell>
                <TableCell className="text-gray-300">{row.amount_raised}</TableCell>
                <TableCell className="text-gray-300 max-w-xs truncate">
                  {row.investors}
                </TableCell>
                <TableCell>
                  {renderPressUrl(row.press_url_1, 1)}
                </TableCell>
                <TableCell>
                  {renderPressUrl(row.press_url_2, 2)}
                </TableCell>
                <TableCell>
                  {renderPressUrl(row.press_url_3, 3)}
                </TableCell>
                <TableCell className="text-gray-300 max-w-xs">
                  {row.investor_contacts && row.investor_contacts !== 'N/A' ? (
                    <div className="text-xs">
                      {row.investor_contacts.length > 100 
                        ? `${row.investor_contacts.substring(0, 100)}...`
                        : row.investor_contacts
                      }
                    </div>
                  ) : (
                    <span className="text-gray-500">N/A</span>
                  )}
                </TableCell>
                <TableCell>{getStatusBadge(row.status)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data.length === 0 && (
        <div className="text-center py-12">
          <Eye className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No data uploaded yet</p>
        </div>
      )}
    </div>
  );
};
